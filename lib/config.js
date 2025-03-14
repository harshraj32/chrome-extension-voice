// Configuration for Voice Dictation Extension
const config = {
  // OpenAI API settings
  openai: {
    apiKey: '', // Default empty, will be loaded from .env.js if available
    defaultModel: 'gpt-4o'
  },
  
  // Feature flags
  features: {
    useLLM: true,
    autoCorrect: true
  }
};

// Try to load environment variables if available
try {
  if (typeof ENV_VARS !== 'undefined') {
    // Merge environment variables
    config.openai.apiKey = ENV_VARS.OPENAI_API_KEY || config.openai.apiKey;
    config.openai.defaultModel = ENV_VARS.OPENAI_MODEL || config.openai.defaultModel;
    config.features.useLLM = ENV_VARS.USE_LLM !== undefined ? ENV_VARS.USE_LLM : config.features.useLLM;
    config.features.autoCorrect = ENV_VARS.AUTO_CORRECT !== undefined ? ENV_VARS.AUTO_CORRECT : config.features.autoCorrect;
    
    console.log('Environment variables loaded successfully into config');
    console.log('LLM usage set to:', config.features.useLLM);
    console.log('Using model:', config.openai.defaultModel);
    console.log('API key status:', config.openai.apiKey ? 'PROVIDED' : 'MISSING');
  } else {
    console.warn('ENV_VARS not found, using default config values');
  }
} catch (e) {
  console.error('Error loading environment variables:', e);
  console.log('Using default config values');
}

// Make config available in different contexts
if (typeof self !== 'undefined') {
  self.config = config;
  console.log('Config attached to self object');
}

// Export for module contexts if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = config;
} 