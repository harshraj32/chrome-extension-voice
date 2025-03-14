// .env.js - Environment variables
// IMPORTANT: This file should be in your .gitignore to avoid exposing API keys

const ENV_VARS = {
  // Your OpenAI API key (required for LLM features)
  // Get one at: https://platform.openai.com/api-keys
  OPENAI_API_KEY: 'insert-your-api-key-here',
  // Model to use for AI text correction
  // Options: 'gpt-4o', 'gpt-3.5-turbo', etc.
  OPENAI_MODEL: 'gpt-4o',
  
  // Feature flags
  USE_LLM: true,  // Set to true to enable AI correction with LLM
  AUTO_CORRECT: true  // Set to false to disable automatic correction
}; 