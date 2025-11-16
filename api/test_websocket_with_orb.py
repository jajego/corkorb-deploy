"""
WebSocket test script that creates the orb if it doesn't exist.
"""

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
    
    if not token:
        print("[ERROR] JWT token required")
        print("   Usage: python test_websocket_with_orb.py <orb_id> <jwt_token>")
        return
    
    uri = f"ws://localhost:8000/ws/orb/{orb_id}?token={token}"
    print(f"[CONNECT] Connecting to: ws://localhost:8000/ws/orb/{orb_id}?token=...")
    print()
    
    try:
        async with websockets.connect(uri) as websocket:
            print("[OK] WebSocket connected successfully!")
            print()
            
            # Wait for user_joined message (if any) - skip it
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=2.0)
                data = json.loads(response)
                if data.get('type') == 'user_joined':
                    print(f"[RECV] User joined: {data.get('user_id')}")
                    # Continue - we'll check if orb exists next
            except asyncio.TimeoutError:
                pass  # No initial message, that's okay
            except json.JSONDecodeError:
                pass  # Not JSON, that's okay
            print()
            
            # Check if orb exists by trying to get state
            print(f"[INFO] Checking if orb '{orb_id}' exists...")
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
                
                if data.get("type") == "state":
                    papers = data.get("papers", [])
                    print(f"   Orb ID: {data.get('orb_id')}")
                    print(f"   Papers: {len(papers)}")
                    if papers:
                        print(f"   First paper ID: {papers[0].get('id')}")
                    print()
                    print("[OK] Orb exists and WebSocket test completed successfully!")
                elif data.get('type') == 'error':
                    error_msg = data.get('error', '')
                    print(f"   Error: {error_msg}")
                    print(f"   Error code: {data.get('error_code')}")
                    print()
                    if "not found" in error_msg.lower():
                        print(f"[WARNING] Orb '{orb_id}' does not exist in database")
                        print("[INFO] Note: You cannot create a specific orb via WebSocket")
                        print("[INFO] The 'create_orb' message creates an orb with a random UUID")
                        print("[INFO] To use a specific orb_id, create it manually in the database")
                        print()
                        print("[INFO] For testing, you have two options:")
                        print("  1. Create the orb manually in the database first")
                        print("  2. Use the orb_id returned by 'create_orb' message")
                        print()
                        print("[INFO] Connection works, but operations on non-existent orb will fail")
                        return
                    else:
                        print(f"[ERROR] Unexpected error: {error_msg}")
                        return
                else:
                    print(f"[WARNING] Unexpected response type: {data.get('type')}")
                    return
            except asyncio.TimeoutError:
                print("[TIMEOUT] No response received (timeout)")
                return
            except json.JSONDecodeError:
                print(f"[RECV] Received non-JSON response: {response}")
                return
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
        elif status_code == 400:
            print("   Possible issues:")
            print("   - Invalid WebSocket request")
            print("   - Missing required parameters")
        else:
            print(f"   HTTP status code: {status_code}")
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
    if len(sys.argv) > 1:
        orb_id = sys.argv[1]
        token = sys.argv[2] if len(sys.argv) > 2 else None
    else:
        orb_id = input("Enter orb ID (or press Enter for 'test_orb'): ").strip() or "test_orb"
        token = input("Enter JWT token (or press Enter to skip): ").strip() or None
    
    if not token:
        print("[ERROR] JWT token required")
        print("   Usage: python test_websocket_with_orb.py <orb_id> <jwt_token>")
        sys.exit(1)
    
    asyncio.run(test_websocket_connection(orb_id, token))

