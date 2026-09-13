import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import pytest
import asyncio
import aiohttp
from unittest.mock import AsyncMock, patch, MagicMock

from agents import GoogleSearchAgent, UrlResolverAgent, SiteScraperAgent, NLPAgent

@pytest.mark.asyncio
async def test_google_search_agent():
    agent = GoogleSearchAgent()
    
    mock_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Test News Title</title>
          <link>https://news.google.com/test</link>
          <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
          <source>Test Source</source>
        </item>
      </channel>
    </rss>
    """
    
    mock_response = AsyncMock()
    mock_response.text.return_value = mock_xml
    mock_response.raise_for_status = MagicMock()
    
    mock_session = AsyncMock()
    mock_session.get.return_value.__aenter__.return_value = mock_response
    
    results = await agent.search(mock_session, {"query": "test query", "nqueries": "1"})
    assert len(results) == 1
    assert results[0]['title'] == "Test News Title"
    assert results[0]['url'] == "https://news.google.com/test"

@pytest.mark.asyncio
async def test_url_resolver_redirect():
    agent = UrlResolverAgent()
    
    mock_response = AsyncMock()
    mock_response.status = 302
    mock_response.headers = {"Location": "https://real-newspaper.com/article"}
    
    mock_session = AsyncMock()
    mock_session.get.return_value.__aenter__.return_value = mock_response
    
    real_url = await agent.resolve(mock_session, "https://google.com/redirect")
    assert real_url == "https://real-newspaper.com/article"

@pytest.mark.asyncio
async def test_url_resolver_meta_refresh():
    agent = UrlResolverAgent()
    
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.text.return_value = '<html><meta http-equiv="refresh" content="0; url=https://real-site.com"></html>'
    
    mock_session = AsyncMock()
    mock_session.get.return_value.__aenter__.return_value = mock_response
    
    real_url = await agent.resolve(mock_session, "https://google.com/meta")
    assert real_url == "https://real-site.com"

@pytest.mark.asyncio
@patch('agents.genai.Client')
async def test_nlp_agent(mock_client_class):
    mock_response = MagicMock()
    mock_response.text = '["Jalisco", "Nuevo León"]'
    
    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
    mock_client_class.return_value = mock_client
    
    with patch.dict('os.environ', {'GEMINI_API_KEY': 'test_key'}):
        agent = NLPAgent()
        states = await agent.extract_states(None, "Some text about Jalisco and Nuevo Leon.")
        
    assert "Jalisco" in states
    assert "Nuevo León" in states
