// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import DOMPurify from 'dompurify';

/**
 * Security utility functions for sanitizing and validating user input
 * to prevent XSS (Cross-Site Scripting) attacks.
 */

/**
 * Configuration for DOMPurify to allow only safe text content
 * This configuration removes all HTML tags and attributes, keeping only text
 */
const SECURE_TEXT_CONFIG = {
  ALLOWED_TAGS: [], // No HTML tags allowed
  ALLOWED_ATTR: [], // No attributes allowed
  KEEP_CONTENT: true, // Keep text content
  FORCE_BODY: false,
  SANITIZE_DOM: true,
  SANITIZE_NAMED_PROPS: true,
  WHOLE_DOCUMENT: false,
};

/**
 * Configuration for DOMPurify that allows basic safe HTML formatting
 * Use this for content that needs to display basic HTML like bold, italic, etc.
 */
const SAFE_HTML_CONFIG = {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'span'],
  ALLOWED_ATTR: ['class'],
  KEEP_CONTENT: true,
  FORCE_BODY: false,
  SANITIZE_DOM: true,
  SANITIZE_NAMED_PROPS: true,
  WHOLE_DOCUMENT: false,
};

/**
 * Sanitizes text content by removing all HTML and potential XSS vectors
 * This is the most secure option - use for displaying user-generated text content
 * 
 * @param input - The input string to sanitize
 * @returns Sanitized text content with all HTML removed
 */
export function sanitizeTextContent(input: unknown): string {
  // Type validation: only process strings
  if (typeof input !== 'string') {
    console.warn('sanitizeTextContent: Expected string input, received:', typeof input);
    return '';
  }

  // Return empty string for null, undefined, or empty strings
  if (!input || input.trim() === '') {
    return '';
  }

  try {
    // Use DOMPurify to sanitize and strip all HTML
    const sanitized = DOMPurify.sanitize(input, SECURE_TEXT_CONFIG);
    return sanitized.trim();
  } catch (error) {
    console.error('sanitizeTextContent: Error during sanitization:', error);
    return '';
  }
}

/**
 * Sanitizes HTML content while preserving safe formatting tags
 * Use this when you need to allow basic HTML formatting in user content
 * 
 * @param input - The HTML string to sanitize
 * @returns Sanitized HTML with only safe tags and attributes
 */
export function sanitizeHtmlContent(input: unknown): string {
  // Type validation: only process strings
  if (typeof input !== 'string') {
    console.warn('sanitizeHtmlContent: Expected string input, received:', typeof input);
    return '';
  }

  // Return empty string for null, undefined, or empty strings
  if (!input || input.trim() === '') {
    return '';
  }

  try {
    // Use DOMPurify to sanitize HTML while keeping safe tags
    const sanitized = DOMPurify.sanitize(input, SAFE_HTML_CONFIG);
    return sanitized.trim();
  } catch (error) {
    console.error('sanitizeHtmlContent: Error during sanitization:', error);
    return '';
  }
}

/**
 * Validates and sanitizes primitive values for table cells
 * Ensures only safe primitive types are rendered
 * 
 * @param value - The value to validate and sanitize
 * @returns Safe primitive value or empty string
 */
export function sanitizeCellValue(value: unknown): string | number | boolean {
  // Allow primitive types as-is (they're safe)
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  // For strings, sanitize to remove any potential XSS
  if (typeof value === 'string') {
    return sanitizeTextContent(value);
  }

  // For any other type, return empty string and log warning
  if (value !== null && value !== undefined) {
    console.warn('sanitizeCellValue: Unexpected value type:', typeof value, value);
  }

  return '';
}

/**
 * Validates chunk data structure and sanitizes content
 * Specifically designed for ChunkProps data validation
 * 
 * @param chunk - The chunk object to validate and sanitize
 * @returns Sanitized chunk object or null if invalid
 */
export function validateAndSanitizeChunk(chunk: unknown): { 
  ids: string; 
  chunk: string; 
  source: string; 
  page: number;
} | null {
  // Type guard: check if chunk has expected structure
  if (
    typeof chunk !== 'object' || 
    chunk === null ||
    !('ids' in chunk) ||
    !('chunk' in chunk) ||
    !('source' in chunk) ||
    !('page' in chunk)
  ) {
    console.warn('validateAndSanitizeChunk: Invalid chunk structure:', chunk);
    return null;
  }

  const chunkObj = chunk as Record<string, unknown>;

  // Validate and sanitize each field
  const ids = typeof chunkObj.ids === 'string' ? sanitizeTextContent(chunkObj.ids) : '';
  const chunkContent = typeof chunkObj.chunk === 'string' ? sanitizeTextContent(chunkObj.chunk) : '';
  const source = typeof chunkObj.source === 'string' ? sanitizeTextContent(chunkObj.source) : '';
  const page = typeof chunkObj.page === 'number' ? chunkObj.page : 0;

  // Ensure all required fields are present and valid
  if (!ids || !chunkContent || !source) {
    console.warn('validateAndSanitizeChunk: Missing required fields after sanitization');
    return null;
  }

  return {
    ids,
    chunk: chunkContent,
    source,
    page
  };
}

/**
 * Validates that a React element is safe to render
 * Prevents rendering of potentially malicious React elements
 * 
 * @param element - The React element to validate
 * @returns true if safe to render, false otherwise
 */
export function isSafeReactElement(element: unknown): boolean {
  // Only allow valid React elements from trusted sources
  if (!React.isValidElement(element)) {
    return false;
  }

  // Additional validation can be added here based on specific requirements
  // For example, checking element type, props, etc.
  
  return true;
}
