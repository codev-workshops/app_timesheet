import { NextResponse } from 'next/server';
import Joi from 'joi';

interface SqliteError extends Error {
  code?: string;
}

export function handleApiError(err: unknown): NextResponse {
  console.error('Error:', err);

  if (err instanceof Joi.ValidationError || (err && typeof err === 'object' && 'isJoi' in err)) {
    const joiError = err as Joi.ValidationError;
    return NextResponse.json(
      {
        error: 'Validation error',
        details: joiError.details.map((detail) => detail.message),
      },
      { status: 400 }
    );
  }

  const sqlErr = err as SqliteError;
  if (sqlErr.code && sqlErr.code.startsWith('SQLITE_')) {
    return NextResponse.json(
      {
        error: 'Database error',
        message: 'An error occurred while processing your request',
      },
      { status: 500 }
    );
  }

  const error = err as Error;
  return NextResponse.json(
    { error: error.message || 'Internal server error' },
    { status: 500 }
  );
}
