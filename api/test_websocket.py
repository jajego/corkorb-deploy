"""Simple script to test WebSocket connection."""

import asyncio
import json
import sys
import websockets
from websockets.exceptions import InvalidStatus, ConnectionClosed

async def test_websocket_connection(orb_id: str, token: str = None):
  """Test WebSocket connection with authentication."""
  print("=" * 50)
  print("WebSocket Connection Test")
  print("=" * 50)
  print()
  
  # Build WebSocket URL
  if token:
    uri = f"ws://localhost:8000/ws/orb/{orb_id}?token={token}"
    print(f"[CONNECT] Connecting to: ws://localhost:8000/ws/orb/{orb_id}?token=...")
  else:
    uri = f"ws://localhost:8000/ws/orb/{orb_id}"
    print(f"[CONNECT] Connecting to: ws://localhost:8000/ws/orb/{orb_id}")
    print("[WARNING] No token provided (will use anonymous user if Clerk not configured)")
  print()
  
  try:
    async with websockets.connect(uri) as websocket:
      print("[OK] WebSocket connected successfully!")
      print()
      
      # Wait for user_joined message
      try:
        response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
        data = json.loads(response)
        print(f"[RECV] Received message: {data.get('type')}")
        if data.get('type') == 'user_joined':
          print(f"   User ID: {data.get('user_id')}")
          print(f"   Orb ID: {data.get('orb_id')}")
      except asyncio.TimeoutError:
        print("[TIMEOUT] No initial message received (timeout)")
      except json.JSONDecodeError:
        print(f"[RECV] Received non-JSON message: {response}")
      print()
      
      # Send get_state message
      print("[SEND] Sending get_state message...")
      message = {
        "type": "get_state",
        "orb_id": orb_id
      }
      await websocket.send(json.dumps(message))
      print("[OK] Message sent")
      print()
      
      # Wait for response
      try:
        response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
        data = json.loads(response)
        print(f"[RECV] Received response: {data.get('type')}")
        if data.get('type') == 'state':
          print(f"   Orb ID: {data.get('orb_id')}")
          print(f"   Papers: {len(data.get('papers', []))}")
        elif data.get('type') == 'error':
          print(f"   Error: {data.get('error')}")
          print(f"   Message: {data.get('message')}")
      except asyncio.TimeoutError:
        print("[TIMEOUT] No response received (timeout)")
      except json.JSONDecodeError:
        print(f"[RECV] Received non-JSON response: {response}")
      print()
      
      # Wait for ping (heartbeat)
      try:
        response = await asyncio.wait_for(websocket.recv(), timeout=35.0)
        data = json.loads(response)
        if data.get('type') == 'ping':
          print("[RECV] Received ping (heartbeat)")
          print("[SEND] Sending pong...")
          pong_message = {"type": "pong"}
          await websocket.send(json.dumps(pong_message))
          print("[OK] Pong sent")
      except asyncio.TimeoutError:
        print("[TIMEOUT] No ping received (timeout - may be normal)")
      except json.JSONDecodeError:
        print(f"[RECV] Received non-JSON message: {response}")
      print()
      
      print("[OK] WebSocket test completed successfully!")
      print("   Connection will close in 5 seconds...")
      await asyncio.sleep(5)
      
  except InvalidStatus as e:
    print(f"[ERROR] WebSocket connection failed: {e}")
    print()
    status_code = e.status_code if hasattr(e, 'status_code') else None
    if status_code == 403:
      print("   Possible issues:")
      print("   - Authentication failed (invalid token)")
      print("   - User is banned")
      print("   - Connection limit reached")
      print("   - Debug mode not enabled (check APP_DEBUG=true in .env)")
    elif status_code == 400:
      print("   Possible issues:")
      print("   - Invalid WebSocket request")
      print("   - Missing required parameters")
    else:
      print(f"   HTTP status code: {status_code}")
      print("   Message: If this is 403, make sure APP_DEBUG=true in .env")
  except ConnectionClosed as e:
    print(f"[ERROR] WebSocket connection closed: {e}")
    print()
    print("   Possible issues:")
    print("   - Server closed connection")
    print("   - Heartbeat timeout")
    print("   - Authentication error")
  except Exception as e:
    print(f"[ERROR] Error: {e}")
    import traceback
    traceback.print_exc()

if __name__ == "__main__":
  # Get orb_id and token from command line or prompt
  if len(sys.argv) > 1:
    orb_id = sys.argv[1]
    token = sys.argv[2] if len(sys.argv) > 2 else None
  else:
    orb_id = input("Enter orb ID (or press Enter for 'test_orb'): ").strip() or "test_orb"
    token = input("Enter JWT token (or press Enter to skip): ").strip() or None
  
  asyncio.run(test_websocket_connection(orb_id, token))

