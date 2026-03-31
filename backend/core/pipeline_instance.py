from core.rag_pipeline import RAGPipeline

_pipeline = RAGPipeline()

def get_pipeline() -> RAGPipeline:
    return _pipeline
