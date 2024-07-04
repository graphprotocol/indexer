// until we find a way to avoid `punycode` we suppress the warnings in tests
process.env.NODE_NO_WARNINGS = "1";

module.exports = {
  collectCoverage: true,
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/dist/", ".yalc"],
};
