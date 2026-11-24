const { URL } = require('node:url');

module.exports = function (api) {
  const raw = api.cache.using(() => process.env.MOBILE_API_URL || '');
  const version = api.cache.using(() => process.env.MOBILE_APP_VERSION || '1.0.0');
  if (raw) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== raw) {
      throw new Error('MOBILE_API_URL must be an HTTPS origin without a path or credentials.');
    }
  }
  if (!/^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$/.test(version))
    throw new Error('MOBILE_APP_VERSION must contain three numeric components.');
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: [
      '@babel/plugin-transform-export-namespace-from',
      ({ types }) => ({
        visitor: {
          ReferencedIdentifier(path) {
            if (path.node.name === 'RENUKA_RELEASE_API_URL')
              path.replaceWith(types.stringLiteral(raw));
            if (path.node.name === 'RENUKA_APP_VERSION')
              path.replaceWith(types.stringLiteral(version));
          },
        },
      }),
    ],
  };
};
