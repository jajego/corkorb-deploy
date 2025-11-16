#!/usr/bin/env python3
"""Quick test to verify JWT token."""

import sys
import json
import base64

def decode_jwt_payload(token: str) -> dict:
    """Decode JWT payload (without verification)."""
    try:
        # JWT format: header.payload.signature
        parts = token.split('.')
        if len(parts) != 3:
            return {"error": "Invalid JWT format"}
        
        # Decode payload (second part)
        payload_b64 = parts[1]
        # Add padding if needed
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += '=' * padding
        
        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        payload = json.loads(payload_bytes.decode('utf-8'))
        return payload
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_token.py <jwt_token>")
        sys.exit(1)
    
    token = sys.argv[1]
    payload = decode_jwt_payload(token)
    
    if "error" in payload:
        print(f"Error decoding token: {payload['error']}")
        sys.exit(1)
    
    print("Token payload:")
    print(json.dumps(payload, indent=2))
    
    # Check expiration
    if "exp" in payload:
        import time
        exp_time = payload["exp"]
        current_time = time.time()
        if exp_time < current_time:
            print(f"\n⚠ Token EXPIRED!")
            print(f"  Expired: {exp_time} (current: {current_time})")
            print(f"  Expired {int((current_time - exp_time) / 60)} minutes ago")
        else:
            print(f"\n✓ Token is valid")
            print(f"  Expires in: {int((exp_time - current_time) / 60)} minutes")
    
    # Check user ID
    if "sub" in payload:
        print(f"\nUser ID: {payload['sub']}")

