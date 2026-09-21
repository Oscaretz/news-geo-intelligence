import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock

from agents import GoogleSearchAgent, UrlResolverAgent, NLPAgent

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
    
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = mock_xml
    
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=mock_response)
    
    results = await agent.search(mock_session, {"query": "test query", "nqueries": "1"})
    assert len(results) == 1
    assert results[0]['title'] == "Test News Title"
    assert results[0]['url'] == "https://news.google.com/test"

@pytest.mark.asyncio
@patch('agents.async_playwright')
async def test_url_resolver(mock_playwright):
    mock_page = AsyncMock()
    mock_page.url = "https://real-newspaper.com/article"
    
    mock_context = AsyncMock()
    mock_context.new_page = AsyncMock(return_value=mock_page)
    
    mock_browser = AsyncMock()
    mock_browser.new_context = AsyncMock(return_value=mock_context)
    
    mock_p_instance = AsyncMock()
    mock_p_instance.chromium.launch = AsyncMock(return_value=mock_browser)
    
    mock_playwright.return_value.__aenter__.return_value = mock_p_instance
    
    agent = UrlResolverAgent()
    real_url = await agent.resolve(None, "https://google.com/redirect")
    assert real_url == "https://real-newspaper.com/article"

@pytest.mark.asyncio
async def test_nlp_agent():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"response": '{"locations": ["Jalisco", "Nuevo León"]}'}
    
    mock_session = AsyncMock()
    mock_session.post = AsyncMock(return_value=mock_response)
    
    agent = NLPAgent()
    states = await agent.extract_states(mock_session, "Some text about Jalisco and Nuevo Leon.", title="News in Jalisco", country="mx")
    assert "Jalisco" in states
    assert "Nuevo León" in states

