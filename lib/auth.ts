import { type NextRequest, NextResponse } from 'next/server';
import { dbGet, dbRun, initializeDatabase } from './db';

let dbInitialized = false;

async function ensureDb() {
  if (!dbInitialized) {
    await initializeDatabase();
    dbInitialized = true;
  }
}

export async function authenticateRequest(
  request: NextRequest
): Promise<{ userEmail: string } | NextResponse> {
  await ensureDb();

  const userEmail =
    request.headers.get('x-user-email') ||
    request.cookies.get('user_email')?.value;

  if (!userEmail) {
    return NextResponse.json(
      { error: 'User email required in x-user-email header' },
      { status: 401 }
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(userEmail)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
  }

  const row = await dbGet<{ email: string }>(
    'SELECT email FROM users WHERE email = ?',
    [userEmail]
  );

  if (!row) {
    await dbRun('INSERT INTO users (email) VALUES (?)', [userEmail]);
  }

  return { userEmail };
}
