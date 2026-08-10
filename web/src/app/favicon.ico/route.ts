import { NextResponse } from 'next/server';

export function GET(request: Request) {
  return NextResponse.redirect(new URL('/LOGO4_XOANEN.png', request.url), 307);
}
