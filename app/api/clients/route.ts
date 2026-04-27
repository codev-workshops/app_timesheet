import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { dbAll, dbRun, dbGet } from '@/lib/db';
import { clientSchema } from '@/lib/validation';
import { handleApiError } from '@/lib/errorHandler';

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const rows = await dbAll(
      'SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE user_email = ? ORDER BY name',
      [authResult.userEmail]
    );

    return NextResponse.json({ clients: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const { error, value } = clientSchema.validate(body);
    if (error) {
      return NextResponse.json(
        { error: 'Validation error', details: error.details.map((d) => d.message) },
        { status: 400 }
      );
    }

    const { name, description, department, email } = value;

    const result = await dbRun(
      'INSERT INTO clients (name, description, department, email, user_email) VALUES (?, ?, ?, ?, ?)',
      [name, description || null, department || null, email || null, authResult.userEmail]
    );

    const row = await dbGet(
      'SELECT id, name, description, department, email, created_at, updated_at FROM clients WHERE id = ?',
      [result.lastID]
    );

    return NextResponse.json(
      { message: 'Client created successfully', client: row },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (authResult instanceof NextResponse) return authResult;

    const result = await dbRun('DELETE FROM clients WHERE user_email = ?', [
      authResult.userEmail,
    ]);

    return NextResponse.json({
      message: 'All clients deleted successfully',
      deletedCount: result.changes,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
