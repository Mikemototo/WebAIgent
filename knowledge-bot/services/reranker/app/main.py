from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

app = FastAPI()
model_name = "BAAI/bge-reranker-v2-m3"
tok = AutoTokenizer.from_pretrained(model_name)
mdl = AutoModelForSequenceClassification.from_pretrained(model_name)

class Item(BaseModel):
    query: str
    passages: List[str]

@app.post("/rerank")
def rerank(item: Item):
    pairs = [(item.query, p) for p in item.passages]
    enc = tok([q for q,_ in pairs], [p for _,p in pairs], padding=True, truncation=True, return_tensors="pt")
    with torch.no_grad():
        scores = mdl(**enc).logits.view(-1).tolist()
    order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    return {"order": order, "scores": scores}
