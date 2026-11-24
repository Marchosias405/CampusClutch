/* global Deno */
import { handleEmailVerified } from './handler.ts';
Deno.serve(handleEmailVerified);
