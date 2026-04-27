import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { emailSchema } from '@/lib/validation';
import { dbGet, dbRun, initializeDatabase } from '@/lib/db';
import { handleApiError } from '@/lib/errorHandler';

let dbInitialized = false;
async function ensureDb() {
  if (!dbInitialized) {
    await initializeDatabase();
    dbInitialized = true;
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureDb();
    const body = await request.json();
    const { error, value } = emailSchema.validate(body);
    if (error) {
      return NextResponse.json(
        { error: 'Validation error', details: error.details.map((d) => d.message) },
        { status: 400 }
      );
    }

    const { email } = value;

    const row = await dbGet<{ email: string; created_at: string }>(
      'SELECT email, created_at FROM users WHERE email = ?',
      [email]
    );

    const cookieStore = await cookies();

    if (row) {
      cookieStore.set('user_email', email, {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });

      return NextResponse.json({
        message: 'Login successful',
        user: { email: row.email, createdAt: row.created_at },
      });
    }

    await dbRun('INSERT INTO users (email) VALUES (?)', [email]);

    cookieStore.set('user_email', email, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return NextResponse.json(
      {
        message: 'User created and logged in successfully',
        user: { email, createdAt: new Date().toISOString() },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
