// MOCK AUTHENTICATION - NOT PRODUCTION AUTH.
// Two synthetic guardians so we can demonstrate "one parent cannot see another parent's child".
// In production this file is replaced by a real identity provider (for example Amazon Cognito),
// with hashed passwords, MFA and an OTP flow. The passwords below are fake, public demo values.
const MOCK_GUARDIANS = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    username: 'neha.sharma',
    displayName: 'Neha Sharma (synthetic)',
    password: 'mock-password-1',
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    username: 'rohit.verma',
    displayName: 'Rohit Verma (synthetic)',
    password: 'mock-password-2',
  },
];

const findByCredentials = (username, password) =>
  MOCK_GUARDIANS.find((g) => g.username === username && g.password === password) || null;

const findById = (id) => MOCK_GUARDIANS.find((g) => g.id === id) || null;

module.exports = { MOCK_GUARDIANS, findByCredentials, findById };
