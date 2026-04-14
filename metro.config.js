// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Force Metro to use the compiled react-native-svg build instead of the TS source entry.
config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    ...(config.resolver?.extraNodeModules || {}),
    'react-native-svg': path.resolve(__dirname, 'node_modules/react-native-svg/lib/module'),
  },
};

// Suppress InternalBytecode.js source map errors (harmless Metro bundler issue)
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      // Suppress InternalBytecode.js errors
      if (req.url && req.url.includes('InternalBytecode.js')) {
        return res.status(404).end();
      }
      return middleware(req, res, next);
    };
  },
};

module.exports = config;

