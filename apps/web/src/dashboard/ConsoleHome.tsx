'use client'
/**
 * ConsoleHome — the ops console mounted as the Payload admin DASHBOARD view.
 * One portal: signing into /admin lands you on the console (Overview ·
 * Members · Events · Reports · Health · Team) with the Payload sidebar as
 * the records backend. The standalone /console route now redirects here.
 *
 * AdminApp's own Gate calls payload.me() with the same admin session cookie,
 * so it resolves signed-in immediately — no second login.
 */
import React from 'react'
import { AdminApp } from './AdminApp'

export default function ConsoleHome() {
  return <AdminApp />
}
