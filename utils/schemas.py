from pydantic import BaseModel, Field
from typing import List

class Entity(BaseModel):
    entity_text: str = Field(description="The text of the entity found in the article.")
    entity_type: str = Field(description="The type of the entity (e.g., PERSON, ORGANIZATION, LOCATION).")

class NewsMetrics(BaseModel):
    article_id: str = Field(description="The ID of the article being analyzed")
    sentiment_score: float = Field(description="As a float. Sentiment score between -1.0 (very negative) and 1.0 (very positive).")
    summary: str = Field(description="A brief 1-2 sentence summary of the article.")
    entities_list: List[Entity] = Field(description="A list of named entities extracted from the article.")
    locations_list: List[str] = Field(description="A list of strictly mapped geographic locations mentioned in the article.")


class BatchNewsMetrics(BaseModel):
    results: List[NewsMetrics] = Field(description="A list of analysis results for each article provided.")
