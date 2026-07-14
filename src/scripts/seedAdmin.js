import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import mongoose from 'mongoose';

import { connectDatabase } from '../config/database.js';
import { User } from '../models/user.model.js';

const rl = readline.createInterface({ input, output });

const run = async () => {
  await connectDatabase();

  const name = await rl.question('Admin name: ');
  const email = await rl.question('Admin email: ');
  const password = await rl.question('Admin password (min 8 chars): ');

  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw new Error('A user with this email already exists');
  }

  await User.create({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password: password.trim(),
    role: 'admin'
  });

  console.log('Admin user created successfully');
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await mongoose.disconnect();
  });
