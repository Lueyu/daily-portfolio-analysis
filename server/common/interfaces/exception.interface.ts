/**
 * Domain (business) exception.
 *
 * Thrown by services when a request violates a business rule (e.g. insufficient
 * holdings for a sale, duplicate watchlist entry, invalid state transition).
 * Carries an explicit business `ResponseCode` and optional HTTP status, and is
 * translated into the unified error envelope by `GlobalExceptionFilter`.
 */
import { HttpStatus } from '@nestjs/common';
import { RESPONSE_CODE_TO_HTTP_STATUS_MAP, ResponseCode } from '../constants/api_response_code';

/**
 * Error type for expected, domain-level failures. Extends `Error` so it plays
 * well with `instanceof` checks and stack traces.
 */
export class BusinessException extends Error {
  /**
   * @param code        Business result code that categorizes the failure.
   * @param message     Human-readable description of the failure.
   * @param httpStatus  HTTP status to return; defaults to 400 Bad Request.
   * @param details     Optional structured detail string.
   * @param fieldErrors Optional per-field validation errors.
   */
  constructor(
    public readonly code: ResponseCode,
    public readonly message: string,
    public readonly httpStatus: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'BusinessException';
  }

  /**
   * Resolves the HTTP status implied by this exception's business code via the
   * forward mapping table. Note: the constructor's explicit `httpStatus` field is
   * preferred by the filter; this is a convenience resolver.
   *
   * @returns The mapped HTTP status code.
   */
  getHttpStatus(): HttpStatus {
    return RESPONSE_CODE_TO_HTTP_STATUS_MAP[this.code];
  }
}
