// Compatibility entry point: additive catalogue import; never deletes workout history.
import { importCatalogue } from '../scripts/import_exercise_catalog';
import prisma from '../config/prisma';
importCatalogue(process.argv.includes('--dry-run'))
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
