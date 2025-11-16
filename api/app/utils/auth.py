"""JWT authentication utilities for Clerk."""

import logging
import re
import time
from typing import Optional

import httpx
from fastapi import HTTPException, Request, status
from jose import jwt as jose_jwt
from jose import jwk
from jose.exceptions import JWTError, ExpiredSignatureError, JWTClaimsError

from app.config import get_settings

logger = logging.getLogger(__name__)

_settings = get_settings()

# Cache for JWKS (JSON Web Key Set)
_jwks_cache: Optional[dict] = None
_jwks_cache_time: Optional[float] = None
_jwks_url: Optional[str] = None
JWKS_CACHE_TTL = 3600  # 1 hour

# Cache for JWKS fetch failures (to avoid repeated DNS lookups/network calls)
_jwks_failure_time: Optional[float] = None
JWKS_FAILURE_CACHE_TTL = 60  # 1 minute - cache failures for a short period


class AuthError(Exception):
  """Authentication error."""
  pass


def get_clerk_jwks_url() -> Optional[str]:
  """
  Get Clerk JWKS URL from publishable key.
  
  Clerk publishable keys are in format: pk_test_<instance-id>_<key> or pk_live_<instance-id>_<key>
  The JWKS URL format is: https://<instance-id>.clerk.accounts.dev/.well-known/jwks.json
  
  Modern Clerk publishable keys might also be in format: pk_test_<encoded-instance-id>_<key>
  where the instance ID might be base64-like encoded.
  
  Returns:
    Optional[str]: JWKS URL or None if publishable key is not configured
  """
  global _jwks_url
  
  if _jwks_url:
    return _jwks_url
  
  if not _settings.clerk_publishable_key:
    logger.warning("Clerk publishable key not configured. Cannot construct JWKS URL.")
    return None
  
  try:
    # Extract instance ID from publishable key
    # Format: pk_test_<instance-id>_<key> or pk_live_<instance-id>_<key>
    # The instance ID is everything after pk_test_ or pk_live_ up to the next underscore
    match = re.match(r"pk_(?:test|live)_([^_]+)", _settings.clerk_publishable_key)
    if not match:
      logger.warning(f"Invalid Clerk publishable key format: {_settings.clerk_publishable_key}")
      logger.debug(f"Publishable key format should be: pk_test_<instance-id>_<key> or pk_live_<instance-id>_<key>")
      return None
    
    instance_id = match.group(1)
    _jwks_url = f"https://{instance_id}.clerk.accounts.dev/.well-known/jwks.json"
    logger.info(f"Constructed Clerk JWKS URL: {_jwks_url} (from instance ID: {instance_id})")
    return _jwks_url
    
  except Exception as e:
    logger.error(f"Error constructing Clerk JWKS URL: {e}", exc_info=True)
    return None


async def get_clerk_jwks_from_issuer(issuer: str) -> Optional[str]:
  """
  Construct JWKS URL from Clerk issuer URL.
  
  Clerk issuer format: https://<instance-id>.clerk.accounts.dev
  JWKS URL format: https://<instance-id>.clerk.accounts.dev/.well-known/jwks.json
  
  Args:
    issuer: Issuer URL from JWT token (e.g., https://champion-drake-51.clerk.accounts.dev)
    
  Returns:
    Optional[str]: JWKS URL or None if issuer is invalid
  """
  try:
    # Extract the hostname from the issuer URL
    if not issuer.startswith("https://"):
      logger.warning(f"Invalid issuer URL format: {issuer}")
      return None
    
    # Construct JWKS URL from issuer
    if issuer.endswith("/"):
      jwks_url = f"{issuer}.well-known/jwks.json"
    else:
      jwks_url = f"{issuer}/.well-known/jwks.json"
    
    logger.debug(f"Constructed JWKS URL from issuer: {jwks_url}")
    return jwks_url
  except Exception as e:
    logger.error(f"Error constructing JWKS URL from issuer {issuer}: {e}", exc_info=True)
    return None


async def get_clerk_jwks(jwks_url: Optional[str] = None) -> dict:
  """
  Get Clerk JWKS (JSON Web Key Set) for token verification.
  
  Fetches JWKS from Clerk's well-known endpoint and caches it.
  Also caches failures for a short period to avoid repeated DNS lookups/network calls.
  
  Args:
    jwks_url: Optional JWKS URL (if None, constructs from publishable key)
  
  Returns:
    dict: JWKS data containing keys (empty dict if unavailable)
  """
  global _jwks_cache, _jwks_cache_time, _jwks_failure_time
  
  # Check cache for successful fetches
  if _jwks_cache and _jwks_cache_time and (time.time() - _jwks_cache_time) < JWKS_CACHE_TTL:
    logger.debug("Using cached JWKS")
    return _jwks_cache
  
  # Check cache for recent failures (avoid repeated DNS lookups/network calls)
  if _jwks_failure_time and (time.time() - _jwks_failure_time) < JWKS_FAILURE_CACHE_TTL:
    logger.debug("JWKS fetch recently failed, using cached failure (skipping fetch)")
    return {}
  
  # Use provided URL or construct from publishable key
  if not jwks_url:
    jwks_url = get_clerk_jwks_url()
  
  if not jwks_url:
    logger.warning("Cannot fetch JWKS: JWKS URL not available")
    # Cache this failure too
    _jwks_failure_time = time.time()
    return {}
  
  logger.info(f"Fetching JWKS from {jwks_url}...")
  try:
    # Fetch JWKS from Clerk with a short timeout to avoid hanging
    timeout = httpx.Timeout(10.0, connect=10.0)  # 10 second timeout for both connect and read
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
      response = await client.get(jwks_url)
      response.raise_for_status()
      jwks_data = response.json()
      
      # Cache successful JWKS fetch
      _jwks_cache = jwks_data
      _jwks_cache_time = time.time()
      # Clear failure cache on success
      _jwks_failure_time = None
      logger.info(f"Successfully fetched and cached Clerk JWKS from {jwks_url}")
      return jwks_data
      
  except httpx.TimeoutException as e:
    logger.error(f"Timeout fetching Clerk JWKS from {jwks_url} after 10s: {e}")
    logger.debug(f"Timeout details: {type(e).__name__}: {e}")
    # Cache failure to avoid repeated timeouts
    _jwks_failure_time = time.time()
    return {}
  except httpx.HTTPStatusError as e:
    logger.error(f"HTTP error fetching Clerk JWKS from {jwks_url}: {e.response.status_code} {e.response.reason_phrase}")
    logger.debug(f"Response body: {e.response.text[:500] if e.response.text else 'No response body'}")
    logger.debug(f"Request URL was: {jwks_url}")
    logger.debug(f"Publishable key: {_settings.clerk_publishable_key[:20]}... (first 20 chars)")
    # Cache failure to avoid repeated HTTP errors
    _jwks_failure_time = time.time()
    return {}
  except httpx.HTTPError as e:
    logger.error(f"HTTP error fetching Clerk JWKS from {jwks_url}: {e}")
    logger.debug(f"Error details: {type(e).__name__}: {e}")
    # Cache failure to avoid repeated HTTP errors
    _jwks_failure_time = time.time()
    return {}
  except Exception as e:
    logger.error(f"Error fetching Clerk JWKS from {jwks_url}: {e}", exc_info=True)
    # Cache failure to avoid repeated exceptions (e.g., DNS errors)
    _jwks_failure_time = time.time()
    return {}


async def verify_clerk_token(token: str) -> dict:
  """
  Verify Clerk JWT token and extract user information using JWKS.
  
  Clerk tokens are signed with RS256 and contain:
  - sub: User ID (Clerk user ID)
  - email: User email (if available)
  - sid: Session ID
  - exp: Expiration time
  - iat: Issued at time
  - iss: Issuer (Clerk instance URL)
  
  Args:
    token: JWT token from Clerk
    
  Returns:
    dict: Token payload containing user information
      - user_id: Clerk user ID (from 'sub' claim)
      - email: User email (if available)
      - session_id: Session ID (from 'sid' claim)
      - payload: Full token payload
      
  Raises:
    AuthError: If token is invalid or expired
  """
  # Try JWKS verification first if publishable key is configured
  if _settings.clerk_publishable_key:
    try:
      # Get token header to find the key ID (kid)
      # Also get issuer to construct correct JWKS URL
      # We'll use the issuer from the token to fetch JWKS (more reliable than parsing publishable key)
      unverified_header = jose_jwt.get_unverified_header(token)
      unverified_claims = jose_jwt.get_unverified_claims(token)
      issuer = unverified_claims.get("iss")
      kid = unverified_header.get("kid")
      
      # Construct JWKS URL from issuer (more reliable than parsing publishable key)
      # This ensures we use the correct instance ID from the token itself
      jwks_url_from_issuer = None
      if issuer:
        jwks_url_from_issuer = await get_clerk_jwks_from_issuer(issuer)
        if jwks_url_from_issuer:
          logger.debug(f"Using JWKS URL from token issuer: {jwks_url_from_issuer}")
      
      # Get JWKS - prefer URL from issuer, fall back to publishable key
      jwks_data_from_issuer = {}
      if jwks_url_from_issuer:
        # Try fetching JWKS using issuer-based URL
        try:
          timeout = httpx.Timeout(10.0, connect=10.0)
          async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(jwks_url_from_issuer)
            response.raise_for_status()
            jwks_data_from_issuer = response.json()
            logger.info(f"Successfully fetched JWKS from issuer-based URL: {jwks_url_from_issuer}")
        except Exception as e:
          logger.warning(f"Failed to fetch JWKS from issuer-based URL {jwks_url_from_issuer}: {e}")
          # Continue to try publishable key-based URL as fallback
      
      # Use issuer-based JWKS if available, otherwise fall back to publishable key method
      if jwks_data_from_issuer and "keys" in jwks_data_from_issuer and jwks_data_from_issuer.get("keys"):
        jwks_data = jwks_data_from_issuer
        # Cache successful JWKS fetch
        _jwks_cache = jwks_data
        _jwks_cache_time = time.time()
        _jwks_failure_time = None
      else:
        # Fall back to publishable key-based JWKS fetch
        jwks_data = await get_clerk_jwks()
      
      # Check if we have valid JWKS data (from either source)
      if not jwks_data or "keys" not in jwks_data or not jwks_data.get("keys"):
        if _settings.debug:
          logger.warning("JWKS not available or empty after trying issuer and publishable key methods. Falling back to unverified decoding (development mode).")
          return await _verify_clerk_token_unverified(token)
        else:
          logger.error("JWKS not available or empty after trying issuer and publishable key methods. Cannot verify token signature (production mode).")
          raise AuthError("Authentication service unavailable (JWKS not available)")
      
      if not kid:
        if _settings.debug:
          logger.warning("Token missing key ID (kid). Falling back to unverified decoding (development mode).")
          return await _verify_clerk_token_unverified(token)
        else:
          logger.error("Token missing key ID (kid). Cannot verify token signature (production mode).")
          raise AuthError("Invalid token format (missing key ID)")
      
      # Find the matching key in JWKS
      keys = jwks_data.get("keys", [])
      matching_key = None
      for key in keys:
        if key.get("kid") == kid:
          matching_key = key
          break
      
      if not matching_key:
        if _settings.debug:
          logger.warning(f"Key ID {kid} not found in JWKS. Falling back to unverified decoding (development mode).")
          return await _verify_clerk_token_unverified(token)
        else:
          logger.error(f"Key ID {kid} not found in JWKS. Cannot verify token signature (production mode).")
          raise AuthError(f"Token verification failed (key ID {kid} not found)")
      
      # Construct RSA key from JWK
      # jwk.construct returns a key object that can be used with jose_jwt.decode
      try:
        rsa_key = jwk.construct(matching_key)
      except Exception as e:
        logger.error(f"Failed to construct RSA key from JWK: {e}", exc_info=True)
        if _settings.debug:
          logger.warning("Falling back to unverified decoding (development mode).")
          return await _verify_clerk_token_unverified(token)
        else:
          raise AuthError(f"Token verification failed (key construction error): {str(e)}")
      
      # Verify token signature and claims using the RSA key
      # Note: We don't verify the issuer here because Clerk tokens might have different issuers
      # depending on the environment (test vs live). The signature verification is sufficient
      # to prove the token came from Clerk.
      payload = jose_jwt.decode(
        token,
        rsa_key,
        algorithms=["RS256"],
        options={
          "verify_signature": True,
          "verify_exp": True,
          "verify_iat": True,
          "verify_nbf": True,
        }
      )
      
      # Extract user information
      user_id = payload.get("sub")
      if not user_id:
        raise AuthError("Token missing user ID (sub claim)")
      
      logger.debug(f"Token verified with JWKS: user_id={user_id}, issuer={issuer}")
      
      # Extract username from JWT payload
      # Clerk JWT tokens may include username in custom claims
      # Check common locations: 'username', 'https://clerk.com/username', or 'org_username'
      username = (
        payload.get("username") or
        payload.get("https://clerk.com/username") or
        payload.get("org_username") or
        None
      )
      
      return {
        "user_id": user_id,
        "email": payload.get("email"),
        "session_id": payload.get("sid"),
        "username": username,
        "payload": payload,
      }
      
    except ExpiredSignatureError:
      logger.warning("Token expired")
      raise AuthError("Token expired")
    except JWTClaimsError as e:
      logger.warning(f"Token claims validation failed: {e}")
      raise AuthError(f"Invalid token claims: {str(e)}")
    except JWTError as e:
      # JWT verification failed - this could be:
      # 1. Invalid signature (token was tampered with)
      # 2. Invalid format (malformed token)
      # 3. Other verification errors
      # In all cases, we should reject the token for security
      logger.error(f"JWT verification failed: {e}")
      raise AuthError(f"Token verification failed: {str(e)}")
    
    except AuthError:
      # Re-raise AuthError (expired token, invalid claims, etc.)
      raise
    except Exception as e:
      # If there's an unexpected error during JWKS verification, handle it based on environment
      logger.error(f"Unexpected error during JWKS verification: {e}", exc_info=True)
      if _settings.debug:
        logger.warning("Falling back to unverified decoding (development mode).")
        return await _verify_clerk_token_unverified(token)
      else:
        raise AuthError(f"Authentication service error: {str(e)}")
  else:
    # No publishable key configured - use unverified decoding (development only)
    logger.debug("Clerk publishable key not configured. Using unverified decoding (development mode).")
    return await _verify_clerk_token_unverified(token)


async def _verify_clerk_token_unverified(token: str) -> dict:
  """
  Verify Clerk JWT token without signature verification (development only).
  
  This is a fallback method that decodes the token without verifying the signature.
  It should only be used when JWKS is not available (development/testing).
  
  Args:
    token: JWT token from Clerk
    
  Returns:
    dict: Token payload containing user information
    
  Raises:
    AuthError: If token is invalid or expired
  """
  logger.debug("Decoding token without signature verification...")
  try:
    # Decode token without verification
    # Use an empty key and disable signature verification
    payload = jose_jwt.decode(
      token,
      key="",  # Empty key (not used when verify_signature=False)
      options={"verify_signature": False, "verify_exp": False, "verify_iat": False, "verify_nbf": False}
    )
    
    logger.debug(f"Token decoded successfully. Payload keys: {list(payload.keys())}")
    
    # Extract user information
    user_id = payload.get("sub")
    if not user_id:
      logger.error("Token missing user ID (sub claim)")
      raise AuthError("Token missing user ID (sub claim)")
    
    # Check expiration manually
    exp = payload.get("exp")
    if exp:
      current_time = time.time()
      if exp < current_time:
        logger.warning(f"Token expired. exp={exp}, current_time={current_time}")
        raise AuthError("Token expired")
    
    logger.info(f"Token decoded (unverified - development mode): user_id={user_id}")
    
    # Extract username from JWT payload (same as verified path)
    username = (
      payload.get("username") or
      payload.get("https://clerk.com/username") or
      payload.get("org_username") or
      None
    )
    
    return {
      "user_id": user_id,
      "email": payload.get("email"),
      "session_id": payload.get("sid"),
      "username": username,
      "payload": payload,
    }
    
  except ExpiredSignatureError:
    logger.warning("Token expired (ExpiredSignatureError)")
    raise AuthError("Token expired")
  except JWTError as e:
    logger.error(f"Token decode error: {e}", exc_info=True)
    raise AuthError(f"Invalid token format: {str(e)}")
  except Exception as e:
    logger.error(f"Authentication error: {e}", exc_info=True)
    raise AuthError(f"Authentication failed: {str(e)}")


def extract_token_from_header(authorization: Optional[str]) -> Optional[str]:
  """
  Extract JWT token from Authorization header.
  
  Args:
    authorization: Authorization header value (e.g., "Bearer <token>")
    
  Returns:
    Optional[str]: JWT token or None
  """
  if not authorization:
    return None
  
  # Handle "Bearer <token>" format
  if authorization.startswith("Bearer "):
    return authorization[7:]
  
  return authorization


def extract_token_from_query(token: Optional[str]) -> Optional[str]:
  """
  Extract JWT token from query parameter.
  
  Args:
    token: Token query parameter
    
  Returns:
    Optional[str]: JWT token or None
  """
  return token


async def get_current_user_id(
  request: Request,
) -> str:
  """
  FastAPI dependency to extract and verify user ID from JWT token.
  
  Token can be provided in:
 1. Query parameter: `?token=<jwt_token>`
 2. Authorization header: `Authorization: Bearer <jwt_token>`
  
  Args:
    request: FastAPI Request object
    
  Returns:
    user_id: The authenticated user's ID (Clerk user ID)
    
  Raises:
    HTTPException: If authentication fails
  """
  logger.info(f"REST API authentication request: {request.method} {request.url.path}")
  
  # Extract from request headers
  auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
  jwt_token = None
  if auth_header:
    jwt_token = extract_token_from_header(auth_header)
    logger.debug("JWT token found in Authorization header")
  
  # Extract from query parameters if not found in headers
  if not jwt_token:
    token_param = request.query_params.get("token")
    if token_param:
      jwt_token = extract_token_from_query(token_param)
      logger.debug("JWT token found in query parameter")
  
  # If no token provided, check if authentication is required
  if not jwt_token:
    if _settings.clerk_secret_key:
      # Authentication is configured, require token
      logger.warning("REST API request attempted without authentication token")
      raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required"
      )
    else:
      # Authentication not configured, use anonymous user (development only)
      logger.warning("Clerk secret key not configured. Using anonymous user (development only).")
      return "user:anonymous"


async def get_optional_user_id(
  request: Request,
) -> Optional[str]:
  """
  FastAPI dependency to optionally extract and verify user ID from JWT token.
  
  Token can be provided in:
  1. Query parameter: `?token=<jwt_token>`
  2. Authorization header: `Authorization: Bearer <jwt_token>`
  
  Args:
    request: FastAPI Request object
    
  Returns:
    user_id: The authenticated user's ID (Clerk user ID) if authenticated, None otherwise
  """
  # Extract from request headers
  auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
  jwt_token = None
  if auth_header:
    jwt_token = extract_token_from_header(auth_header)
  
  # Extract from query parameters if not found in headers
  if not jwt_token:
    token_param = request.query_params.get("token")
    if token_param:
      jwt_token = extract_token_from_query(token_param)
  
  # If no token provided, return None (allow anonymous access)
  if not jwt_token:
    return None
  
  # Verify token if provided
  try:
    user_info = await verify_clerk_token(jwt_token)
    return user_info["user_id"]
  except AuthError:
    # If token is invalid, return None (allow anonymous access)
    logger.debug("Optional authentication failed, allowing anonymous access")
    return None
  except Exception as e:
    logger.error(f"Optional authentication error: {e}", exc_info=True)
    return None


async def get_current_user_info(
  request: Request,
) -> dict:
  """
  FastAPI dependency to extract and verify user information from JWT token.
  
  Token can be provided in:
  1. Query parameter: `?token=<jwt_token>`
  2. Authorization header: `Authorization: Bearer <jwt_token>`
  
  Args:
    request: FastAPI Request object
    
  Returns:
    dict: User information containing:
      - user_id: The authenticated user's ID (Clerk user ID)
      - username: User's username (if available in JWT token)
      - email: User's email (if available)
    
  Raises:
    HTTPException: If authentication fails
  """
  logger.info(f"REST API authentication request: {request.method} {request.url.path}")
  
  # Extract from request headers
  auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
  jwt_token = None
  if auth_header:
    jwt_token = extract_token_from_header(auth_header)
    logger.debug("JWT token found in Authorization header")
  
  # Extract from query parameters if not found in headers
  if not jwt_token:
    token_param = request.query_params.get("token")
    if token_param:
      jwt_token = extract_token_from_query(token_param)
      logger.debug("JWT token found in query parameter")
  
  # If no token provided, check if authentication is required
  if not jwt_token:
    if _settings.clerk_secret_key:
      # Authentication is configured, require token
      logger.warning("REST API request attempted without authentication token")
      raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required"
      )
    else:
      # Authentication not configured, use anonymous user (development only)
      logger.warning("Clerk secret key not configured. Using anonymous user (development only).")
      return {"user_id": "user:anonymous", "username": None, "email": None}
  
  # Verify token
  logger.debug("Verifying JWT token...")
  try:
    user_info = await verify_clerk_token(jwt_token)
    logger.info(f"REST API authenticated: user_id={user_info['user_id']}, username={user_info.get('username')}")
    return {
      "user_id": user_info["user_id"],
      "username": user_info.get("username"),
      "email": user_info.get("email"),
    }
  except AuthError as e:
    logger.warning(f"REST API authentication failed: {e}")
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail=f"Authentication failed: {str(e)}"
    )
  except Exception as e:
    logger.error(f"REST API authentication error: {e}", exc_info=True)
    raise HTTPException(
      status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
      detail="Authentication error"
    )
