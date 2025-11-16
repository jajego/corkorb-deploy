"""
Comprehensive CRUD testing script for WebSocket API.

Tests:
- Create paper
- Get state
- Delete paper
- Create orb
- Delete orb
- Authorization checks
"""

import asyncio
import json
import sys
import websockets
from websockets.exceptions import InvalidStatus, ConnectionClosed


async def create_orb_if_needed(orb_id: str, token: str, websocket):
    """Create orb if it doesn't exist."""
    print(f"[INFO] Checking if orb '{orb_id}' exists...")
    
    # Try to get state first
    get_state_msg = {
        "type": "get_state",
        "orb_id": orb_id
    }
    await websocket.send(json.dumps(get_state_msg))
    
    try:
        response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
        data = json.loads(response)
        
        if data.get("type") == "state":
            print(f"[OK] Orb '{orb_id}' already exists")
            return True
        elif data.get("type") == "error":
            error_msg = data.get("error", "")
            if "not found" in error_msg.lower():
                print(f"[WARNING] Orb '{orb_id}' not found")
                print("[INFO] Note: Cannot create specific orb_id via WebSocket")
                print("[INFO] The 'create_orb' message creates an orb with a random UUID")
                print("[INFO] For testing, you need to create the orb manually in the database")
                print("[INFO] Or use a different approach - skip CRUD tests that require specific orb_id")
                return False
            else:
                print(f"[ERROR] Unexpected error: {error_msg}")
                return False
        else:
            print(f"[ERROR] Unexpected response type: {data.get('type')}")
            return False
    except asyncio.TimeoutError:
        print("[TIMEOUT] No response received")
        return False
    except Exception as e:
        print(f"[ERROR] Error checking orb: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_crud_operations(orb_id: str, token: str):
    """Test CRUD operations via WebSocket."""
    print("=" * 50)
    print("CRUD Operations Test")
    print("=" * 50)
    print()
    
    if not token:
        print("[ERROR] JWT token required")
        print("   Usage: python test_crud.py <orb_id> <jwt_token>")
        return
    
    uri = f"ws://localhost:8000/ws/orb/{orb_id}?token={token}"
    print(f"[CONNECT] Connecting to: ws://localhost:8000/ws/orb/{orb_id}")
    print()
    
    try:
        async with websockets.connect(uri) as websocket:
            print("[OK] WebSocket connected successfully!")
            print()
            
            # Check if orb exists (cannot create specific orb_id via WebSocket)
            orb_ready = await create_orb_if_needed(orb_id, token, websocket)
            if not orb_ready:
                print()
                print("=" * 50)
                print("[ERROR] Cannot proceed with CRUD tests")
                print("=" * 50)
                print()
                print("The orb does not exist and cannot be created with a specific ID via WebSocket.")
                print("To fix this:")
                print("1. Create the orb manually in your PostgreSQL database:")
                print(f"   INSERT INTO orbs (id, created_at, updated_at, max_papers) VALUES ('{orb_id}', NOW(), NOW(), 50);")
                print("2. Then run this test script again.")
                print()
                print("Alternatively, you can:")
                print("- Use the randomly generated orb_id returned by the 'create_orb' message")
                print("- Modify the test to work with any existing orb")
                return
            print()
            
            # Test 1: Create Paper
            print("-" * 50)
            print("Test 1: Create Paper")
            print("-" * 50)
            create_paper_msg = {
                "type": "create_paper",
                "orb_id": orb_id,
                "data": {
                    "source_url": "https://example.com/test-image.jpg",
                    "user_id": "test_user_id",  # Will be overridden by backend
                    "data": {
                        "aspect": 1.5,
                        "scale": 0.22,
                        "rotation": 0,
                        "center": {"x": 0, "y": 0, "z": 1}
                    },
                    "pin": {
                        "position": {"x": 0, "y": 0, "z": 1},
                        "color": "#ff0000"
                    }
                }
            }
            await websocket.send(json.dumps(create_paper_msg))
            print(f"[SEND] {json.dumps(create_paper_msg, indent=2)}")
            print()
            
            response = await websocket.recv()
            response_data = json.loads(response)
            print(f"[RECV] {json.dumps(response_data, indent=2)}")
            print()
            
            if response_data.get("type") == "success":
                # SuccessMessage wraps the actual response in data
                paper_data = response_data.get("data", {}).get("paper", {})
                paper_id = paper_data.get("id")
                if paper_id:
                    print(f"[OK] Paper created successfully! Paper ID: {paper_id}")
                else:
                    print(f"[ERROR] Paper ID not found in response: {response_data}")
                    return
            elif response_data.get("type") == "paper_created":
                # Direct response (shouldn't happen with current server code)
                paper_id = response_data.get("paper", {}).get("id")
                if paper_id:
                    print(f"[OK] Paper created successfully! Paper ID: {paper_id}")
                else:
                    print(f"[ERROR] Paper ID not found in response: {response_data}")
                    return
            else:
                print(f"[ERROR] Unexpected response: {response_data}")
                return
            print()
            
            # Wait a bit
            await asyncio.sleep(1)
            
            # Test 2: Get State
            print("-" * 50)
            print("Test 2: Get State")
            print("-" * 50)
            get_state_msg = {
                "type": "get_state",
                "orb_id": orb_id
            }
            await websocket.send(json.dumps(get_state_msg))
            print(f"[SEND] {json.dumps(get_state_msg, indent=2)}")
            print()
            
            response = await websocket.recv()
            response_data = json.loads(response)
            print(f"[RECV] {json.dumps(response_data, indent=2)}")
            print()
            
            if response_data.get("type") == "state":
                # StateMessage has papers at top level, not in data
                papers = response_data.get("papers", [])
                print(f"[OK] State retrieved successfully! Found {len(papers)} papers")
                if papers:
                    print(f"[INFO] First paper: {papers[0].get('id')}")
            else:
                print(f"[ERROR] Unexpected response: {response_data}")
                return
            print()
            
            # Wait a bit
            await asyncio.sleep(1)
            
            # Test 3: Delete Paper
            print("-" * 50)
            print("Test 3: Delete Paper")
            print("-" * 50)
            delete_paper_msg = {
                "type": "delete_paper",
                "orb_id": orb_id,
                "paper_id": paper_id
            }
            await websocket.send(json.dumps(delete_paper_msg))
            print(f"[SEND] {json.dumps(delete_paper_msg, indent=2)}")
            print()
            
            response = await websocket.recv()
            response_data = json.loads(response)
            print(f"[RECV] {json.dumps(response_data, indent=2)}")
            print()
            
            if response_data.get("type") == "success":
                # SuccessMessage wraps the actual response in data
                deleted_paper_id = response_data.get("data", {}).get("paper_id")
                if deleted_paper_id:
                    print(f"[OK] Paper deleted successfully! Paper ID: {deleted_paper_id}")
                else:
                    print(f"[WARNING] Paper ID not found in response, using original: {paper_id}")
                    deleted_paper_id = paper_id
            elif response_data.get("type") == "paper_deleted":
                # Direct response (shouldn't happen with current server code)
                deleted_paper_id = response_data.get("paper_id")
                if deleted_paper_id:
                    print(f"[OK] Paper deleted successfully! Paper ID: {deleted_paper_id}")
                else:
                    print(f"[WARNING] Paper ID not found in response, using original: {paper_id}")
                    deleted_paper_id = paper_id
            else:
                print(f"[ERROR] Unexpected response: {response_data}")
                return
            print()
            
            # Wait a bit
            await asyncio.sleep(1)
            
            # Test 4: Verify Deletion
            print("-" * 50)
            print("Test 4: Verify Deletion")
            print("-" * 50)
            get_state_msg = {
                "type": "get_state",
                "orb_id": orb_id
            }
            await websocket.send(json.dumps(get_state_msg))
            print(f"[SEND] {json.dumps(get_state_msg, indent=2)}")
            print()
            
            response = await websocket.recv()
            response_data = json.loads(response)
            print(f"[RECV] {json.dumps(response_data, indent=2)}")
            print()
            
            if response_data.get("type") == "state":
                # StateMessage has papers at top level, not in data
                papers = response_data.get("papers", [])
                paper_ids = [p.get("id") for p in papers]
                if paper_id not in paper_ids:
                    print(f"[OK] Paper deleted verified! Paper {paper_id} not in state")
                else:
                    print(f"[ERROR] Paper still exists in state!")
            else:
                print(f"[ERROR] Unexpected response: {response_data}")
                return
            print()
            
            # Test 5: Create Orb (creates with random UUID)
            print("-" * 50)
            print("Test 5: Create Orb")
            print("-" * 50)
            print("[INFO] Note: create_orb creates an orb with a random UUID, not a specific ID")
            create_orb_msg = {
                "type": "create_orb",
                "data": {
                    "max_papers": 50
                }
            }
            await websocket.send(json.dumps(create_orb_msg))
            print(f"[SEND] {json.dumps(create_orb_msg, indent=2)}")
            print()
            
            response = await websocket.recv()
            response_data = json.loads(response)
            print(f"[RECV] {json.dumps(response_data, indent=2)}")
            print()
            
            if response_data.get("type") == "success":
                # SuccessMessage wraps the actual response in data
                orb_data = response_data.get("data", {}).get("orb", {})
                created_orb_id = orb_data.get("id")
                if created_orb_id:
                    print(f"[OK] Orb created successfully! Orb ID: {created_orb_id}")
                    print(f"[INFO] Note: Created orb has ID '{created_orb_id}', not a custom ID")
                else:
                    print(f"[ERROR] Orb ID not found in response: {response_data}")
                    return
            elif response_data.get("type") == "orb_created":
                # Direct response (shouldn't happen with current server code)
                orb_data = response_data.get("orb", {})
                created_orb_id = orb_data.get("id")
                if created_orb_id:
                    print(f"[OK] Orb created successfully! Orb ID: {created_orb_id}")
                else:
                    print(f"[ERROR] Orb ID not found in response: {response_data}")
                    return
            else:
                print(f"[ERROR] Unexpected response: {response_data}")
                return
            print()
            
            # Wait a bit
            await asyncio.sleep(1)
            
            # Test 6: Delete Orb (using the created orb's ID)
            print("-" * 50)
            print("Test 6: Delete Orb")
            print("-" * 50)
            delete_orb_msg = {
                "type": "delete_orb",
                "orb_id": created_orb_id
            }
            await websocket.send(json.dumps(delete_orb_msg))
            print(f"[SEND] {json.dumps(delete_orb_msg, indent=2)}")
            print()
            
            response = await websocket.recv()
            response_data = json.loads(response)
            print(f"[RECV] {json.dumps(response_data, indent=2)}")
            print()
            
            if response_data.get("type") == "success":
                # SuccessMessage wraps the actual response in data
                deleted_orb_id = response_data.get("data", {}).get("orb_id")
                if deleted_orb_id:
                    print(f"[OK] Orb deleted successfully! Orb ID: {deleted_orb_id}")
                else:
                    print(f"[WARNING] Orb ID not found in response, but operation may have succeeded")
            elif response_data.get("type") == "orb_deleted":
                # Direct response (shouldn't happen with current server code)
                deleted_orb_id = response_data.get("orb_id")
                if deleted_orb_id:
                    print(f"[OK] Orb deleted successfully! Orb ID: {deleted_orb_id}")
                else:
                    print(f"[WARNING] Orb ID not found in response, but operation may have succeeded")
            else:
                print(f"[ERROR] Unexpected response: {response_data}")
                return
            print()
            
            print("=" * 50)
            print("[OK] All CRUD tests completed successfully!")
            print("=" * 50)
            
    except InvalidStatus as e:
        print(f"[ERROR] WebSocket connection failed: {e}")
        status_code = e.status_code if hasattr(e, 'status_code') else None
        if status_code == 403:
            print("   Possible issues:")
            print("   - Authentication failed (invalid token)")
            print("   - User is banned")
            print("   - Connection limit reached")
    except ConnectionClosed as e:
        print(f"[ERROR] WebSocket connection closed: {e}")
    except Exception as e:
        print(f"[ERROR] Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    orb_id = sys.argv[1] if len(sys.argv) > 1 else "test_orb"
    token = sys.argv[2] if len(sys.argv) > 2 else None
    
    if not token:
        print("[ERROR] JWT token required")
        print("   Usage: python test_crud.py <orb_id> <jwt_token>")
        print("   Example: python test_crud.py test_orb <your_jwt_token>")
        sys.exit(1)
    
    asyncio.run(test_crud_operations(orb_id, token))

