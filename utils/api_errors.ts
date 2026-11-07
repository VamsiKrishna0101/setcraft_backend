import {Prisma} from '@prisma/client';

// ORM messages include SQL, source excerpts and schema internals. Keep those
// details out of the app while preserving a useful rollout error code.
export function prismaApiError(error:unknown) {
  if(error instanceof Prisma.PrismaClientKnownRequestError) {
    if(['P2021','P2022'].includes(error.code)) return {status:503,body:{error:'The server needs a settings update. Please try again shortly.',code:'SERVER_UPDATE_REQUIRED'}};
    if(['P1001','P1002','P1008','P1017','P2024'].includes(error.code)) return {status:503,body:{error:'The server could not connect. Please try again.',code:'SERVICE_UNAVAILABLE'}};
    return {status:500,body:{error:'This change could not be saved. Please try again.',code:'DATABASE_REQUEST_FAILED'}};
  }
  if(error instanceof Prisma.PrismaClientValidationError || error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientUnknownRequestError) {
    return {status:503,body:{error:'The server could not complete this request. Please try again.',code:'SERVICE_UNAVAILABLE'}};
  }
  return null;
}
