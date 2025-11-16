"""Simple script to test Clerk authentication."""

import asyncio
import sys
from app.utils.auth import verify_clerk_token, AuthError
from app.config import get_settings

async def test_clerk_auth():
  """Test Clerk authentication."""
  settings = get_settings()
  
  print("=" * 50)
  print("Clerk Authentication Test")
  print("=" * 50)
  print()
  
  # Check if Clerk is configured
  if not settings.clerk_secret_key:
    print("WARNING: Clerk secret key not configured!")
    print("   Set CLERK_SECRET_KEY in .env file")
    print("   Authentication will use anonymous user in development mode")
    return
  
  print("[OK] Clerk secret key configured")
  print(f"   Secret key: {settings.clerk_secret_key[:10]}...")
  print()
  
  # Test token verification
  print("Testing token verification...")
  print()
  
  # Get token from command line or prompt
  if len(sys.argv) > 1:
    token = sys.argv[1]
  else:
    token = input("Enter JWT token (or press Enter to skip): ").strip()
    if not token:
      print("Skipping token verification test")
      return
  
  try:
    user_info = await verify_clerk_token(token)
    print("[OK] Token verification successful!")
    print(f"   User ID: {user_info['user_id']}")
    if user_info.get('email'):
      print(f"   Email: {user_info['email']}")
    if user_info.get('session_id'):
      print(f"   Session ID: {user_info['session_id']}")
    print()
    print("[OK] Authentication test passed!")
  except AuthError as e:
    print(f"[ERROR] Authentication failed: {e}")
    print()
    print("Common issues:")
    print("  - Token is expired")
    print("  - Token is invalid")
    print("  - Token is missing user ID")
    print("  - Clerk secret key is incorrect")
  except Exception as e:
    print(f"[ERROR] Error: {e}")
    import traceback
    traceback.print_exc()

if __name__ == "__main__":
  asyncio.run(test_clerk_auth())

