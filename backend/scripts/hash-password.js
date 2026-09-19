// Usage: npm run hash:password -- "your-password-here"
// Prints a bcrypt hash to put in .env as ADMIN_PASSWORD_HASH.
const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('Usage: npm run hash:password -- "your-password-here"');
  process.exit(1);
}

bcrypt.hash(password, 12).then((hash) => {
  console.log(hash);
});
