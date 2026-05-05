import asyncio
import logging
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel

from . import engines, locks


logger = logging.getLogger("domia-ml-server")


class SynthesizeRequest(BaseModel):
    engine: str
    text: str
    voice: Optional[str] = None


class TranscribeRequest(BaseModel):
    engine: str
    file_path: str
    model_name: Optional[str] = None


def build_app(warm: List[str]) -> FastAPI:
    app = FastAPI(title="domia-ml-server", version="0.1.0")

    @app.on_event("startup")
    async def _warm_engines():
        for name in warm:
            engine = engines.ALL_ENGINES.get(name)
            if engine is None:
                logger.warning("warm: unknown engine %s — skipping", name)
                continue
            try:
                await asyncio.to_thread(engine.load)
                logger.info("warm: %s ready", name)
            except NotImplementedError:
                logger.info("warm: %s not implemented yet — skipping", name)
            except Exception as e:
                logger.exception("warm: %s failed: %s", name, e)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/engines")
    async def list_engines():
        return {
            "tts": {
                name: {"loaded": mod.is_loaded()}
                for name, mod in engines.TTS_ENGINES.items()
            },
            "stt": {
                name: {"loaded": mod.is_loaded()}
                for name, mod in engines.STT_ENGINES.items()
            },
        }

    @app.post("/tts/synthesize")
    async def synthesize_tts(req: SynthesizeRequest):
        engine_name = req.engine.upper()
        if not engines.is_tts(engine_name):
            raise HTTPException(status_code=400, detail=f"Unknown TTS engine: {engine_name}")
        engine = engines.TTS_ENGINES[engine_name]
        async with locks.get(engine_name):
            try:
                audio_bytes = await asyncio.to_thread(
                    engine.synthesize, req.text, req.voice
                )
            except NotImplementedError as e:
                raise HTTPException(status_code=501, detail=str(e))
            except Exception as e:
                logger.exception("synthesis failed for %s: %s", engine_name, e)
                raise HTTPException(status_code=500, detail=f"synthesis failed: {e}")
        return Response(
            content=audio_bytes,
            media_type="audio/wav",
            headers={
                "X-Domia-Engine": engine_name,
                "X-Domia-Voice": req.voice or "",
            },
        )

    @app.post("/stt/transcribe")
    async def transcribe_stt(req: TranscribeRequest):
        engine_name = req.engine.upper()
        if not engines.is_stt(engine_name):
            raise HTTPException(status_code=400, detail=f"Unknown STT engine: {engine_name}")
        engine = engines.STT_ENGINES[engine_name]
        async with locks.get(engine_name):
            try:
                transcript = await asyncio.to_thread(
                    engine.transcribe, req.file_path, req.model_name
                )
            except NotImplementedError as e:
                raise HTTPException(status_code=501, detail=str(e))
            except Exception as e:
                logger.exception("transcription failed for %s: %s", engine_name, e)
                raise HTTPException(
                    status_code=500, detail=f"transcription failed: {e}"
                )
        return {"transcript": transcript, "engine": engine_name}

    return app
