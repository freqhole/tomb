// Auto-generated client for users
// DO NOT EDIT

import { z } from 'zod';
import { getBaseUrl } from '../../config';
import * as types from '../../types';

export async function login(params: LoginRequest): Promise<LoginResponse> {
  const validated = LoginRequestSchema.parse(params);

  const response = await fetch(`${getBaseUrl()}/api/users/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
      body: JSON.stringify(validated),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return LoginResponseSchema.parse(data);
}

export async function getUser(params: String): Promise<User> {
  const response = await fetch(`${getBaseUrl()}/api/users/{id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return UserSchema.parse(data);
}

export async function createUser(params: CreateUserRequest): Promise<User> {
  const validated = CreateUserRequestSchema.parse(params);

  const response = await fetch(`${getBaseUrl()}/api/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
      body: JSON.stringify(validated),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return UserSchema.parse(data);
}

