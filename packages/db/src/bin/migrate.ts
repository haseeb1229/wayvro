#!/usr/bin/env node
import { migrateFromEnvironment } from '../cli.js';

console.log(await migrateFromEnvironment(process.env));
