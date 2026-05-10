module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
    verbose: true,
    collectCoverage: true,
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'server/**/*.js',
        '!server/**/__tests__/**',
        '!server/roomManager.js' // Only test extracted logic, not the inline version in server.js
    ]
};