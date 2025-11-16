#!/usr/bin/env python3
"""Full integration test for image upload flow."""

import sys
import io
import asyncio
import json
import time
from pathlib import Path
from typing import Optional, Dict, Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Fix Windows encoding issues
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from app.config import get_settings
from app.db.session import async_session_factory
from app.models.paper import Paper
from app.models.orb import Orb

# ANSI color codes
try:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    BOLD = '\033[1m'
    RESET = '\033[0m'
except:
    GREEN = RED = YELLOW = BLUE = BOLD = RESET = ''


def print_header(text):
    print(f"\n{BOLD}{BLUE}{'=' * 60}{RESET}")
    print(f"{BOLD}{BLUE}{text}{RESET}")
    print(f"{BOLD}{BLUE}{'=' * 60}{RESET}\n")


def print_success(text):
    print(f"{GREEN}✓{RESET} {text}")


def print_error(text):
    print(f"{RED}✗{RESET} {text}")


def print_warning(text):
    print(f"{YELLOW}⚠{RESET} {text}")


def print_info(text):
    print(f"{BLUE}ℹ{RESET} {text}")


class ImageUploadTester:
    def __init__(self, api_base_url: str = "http://localhost:8000", test_user_id: str = "test-user-123", auth_token: Optional[str] = None):
        self.api_base_url = api_base_url.rstrip('/')
        self.test_user_id = test_user_id
        self.auth_token = auth_token
        self.test_orb_id: Optional[str] = None
        self.results: list[Dict[str, Any]] = []
    
    async def create_test_orb(self) -> str:
        """Create a test orb for testing."""
        print_info("Creating test orb...")
        
        # For testing, we'll use a simple approach - create via database
        async with async_session_factory() as session:
            from app.repositories import orb as orb_repo
            orb = await orb_repo.create_orb(session, max_papers=100)
            await session.commit()
            await session.refresh(orb)
            self.test_orb_id = orb.id
            print_success(f"Created test orb: {self.test_orb_id}")
            return orb.id
    
    async def get_auth_token(self) -> Optional[str]:
        """Get authentication token (for now, we'll skip auth in test mode)."""
        # In a real test, you'd authenticate here
        # For now, we'll assume the API allows unauthenticated requests for testing
        # or you can provide a token
        return None
    
    async def upload_image(
        self,
        image_path: Path,
        orb_id: str
    ) -> Dict[str, Any]:
        """Upload an image via the API endpoint."""
        print_info(f"Uploading {image_path.name}...")
        
        # Read image file
        with open(image_path, 'rb') as f:
            file_content = f.read()
        
        # Get file extension
        file_extension = image_path.suffix.lstrip('.')
        
        # Create pin data (required for paper creation)
        pin_data = {
            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            "color": "#ff4d4f"
        }
        
        # Prepare multipart form data
        files = {
            'file': (image_path.name, file_content, f'image/{file_extension}')
        }
        data = {
            'pin': json.dumps(pin_data)
        }
        
        # Prepare headers with auth token if provided
        headers = {}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
            print_info(f"Using auth token (first 20 chars): {self.auth_token[:20]}...")
        
        # Upload via API
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(
                    f"{self.api_base_url}/api/orbs/{orb_id}/papers",
                    files=files,
                    data=data,
                    headers=headers,
                )
                
                if response.status_code == 201:
                    paper_data = response.json()
                    print_success(f"Upload successful: {image_path.name}")
                    return {
                        "success": True,
                        "paper": paper_data,
                        "status_code": response.status_code,
                    }
                elif response.status_code == 401:
                    print_error(f"Upload failed: Authentication required (401)")
                    print_info("Tip: For testing, temporarily remove APP_CLERK_SECRET_KEY from .env")
                    print_info("  or provide a valid JWT token in the Authorization header")
                    return {
                        "success": False,
                        "error": "Authentication required",
                        "status_code": response.status_code,
                    }
                else:
                    print_error(f"Upload failed: {response.status_code} - {response.text}")
                    return {
                        "success": False,
                        "error": response.text,
                        "status_code": response.status_code,
                    }
            except Exception as e:
                print_error(f"Upload exception: {e}")
                return {
                    "success": False,
                    "error": str(e),
                }
    
    async def verify_paper_state(
        self,
        paper_id: str,
        expected_uploaded: bool = True,
        max_wait_seconds: int = 10
    ) -> Dict[str, Any]:
        """Verify paper state in database."""
        start_time = time.time()
        
        while time.time() - start_time < max_wait_seconds:
            async with async_session_factory() as session:
                result = await session.execute(
                    select(Paper).where(Paper.id == paper_id)
                )
                paper = result.scalar_one_or_none()
                
                if paper:
                    # Check if uploaded
                    if paper.uploaded == expected_uploaded:
                        # Check if source_url is CDN URL (not blob)
                        is_cdn_url = (
                            paper.source_url and
                            not paper.source_url.startswith("data:") and
                            ("cloudfront.net" in paper.source_url or "cdn" in paper.source_url.lower())
                        )
                        
                        return {
                            "found": True,
                            "uploaded": paper.uploaded,
                            "validated": paper.validated,
                            "source_url": paper.source_url,
                            "is_cdn_url": is_cdn_url,
                        }
                    else:
                        # Wait a bit more for upload to complete
                        await asyncio.sleep(0.5)
                        continue
                else:
                    # Paper might have been deleted by Rekognition
                    return {
                        "found": False,
                        "deleted": True,
                    }
        
        # Timeout
        return {
            "found": False,
            "timeout": True,
        }
    
    async def wait_for_rekognition(
        self,
        paper_id: str,
        max_wait_seconds: int = 10
    ) -> Dict[str, Any]:
        """Wait for Rekognition check to complete."""
        print_info(f"Waiting for Rekognition check (max {max_wait_seconds}s)...")
        
        start_time = time.time()
        last_validated = None
        check_interval = 0.5  # Check every 500ms initially
        max_interval = 2.0  # Max 2 seconds between checks
        
        while time.time() - start_time < max_wait_seconds:
            async with async_session_factory() as session:
                result = await session.execute(
                    select(Paper).where(Paper.id == paper_id)
                )
                paper = result.scalar_one_or_none()
                
                if not paper:
                    # Paper was deleted (unsafe content)
                    print_warning(f"Paper {paper_id} was deleted (likely unsafe content)")
                    return {
                        "status": "deleted",
                        "safe": False,
                        "validated": False,
                    }
                
                # Check if validated status changed
                if paper.validated != last_validated:
                    if paper.validated:
                        print_success(f"Rekognition check complete: Image is safe")
                        return {
                            "status": "validated",
                            "safe": True,
                            "validated": True,
                        }
                    last_validated = paper.validated
                
                # Exponential backoff: check more frequently at first, then less frequently
                elapsed = time.time() - start_time
                if elapsed < 2:
                    check_interval = 0.5
                elif elapsed < 5:
                    check_interval = 1.0
                else:
                    check_interval = max_interval
                
                await asyncio.sleep(check_interval)
        
        # Timeout - check final state
        async with async_session_factory() as session:
            result = await session.execute(
                select(Paper).where(Paper.id == paper_id)
            )
            paper = result.scalar_one_or_none()
            
            if paper:
                return {
                    "status": "timeout",
                    "validated": paper.validated,
                    "safe": None,  # Unknown
                }
            else:
                return {
                    "status": "deleted",
                    "safe": False,
                }
    
    async def test_image(self, image_path: Path, orb_id: str) -> Dict[str, Any]:
        """Test a single image through the full flow."""
        print_header(f"Testing: {image_path.name}")
        
        result = {
            "image": image_path.name,
            "path": str(image_path),
            "upload": None,
            "state_check": None,
            "rekognition": None,
            "success": False,
        }
        
        # Step 1: Upload
        upload_result = await self.upload_image(image_path, orb_id)
        result["upload"] = upload_result
        
        if not upload_result.get("success"):
            print_error("Upload failed, skipping remaining tests")
            return result
        
        paper_id = upload_result["paper"]["id"]
        print_info(f"Paper ID: {paper_id}")
        
        # Step 2: Verify state (blob → CDN transition)
        print_info("Verifying paper state (blob → CDN transition)...")
        state_result = await self.verify_paper_state(paper_id, expected_uploaded=True)
        result["state_check"] = state_result
        
        if state_result.get("found"):
            if state_result.get("is_cdn_url"):
                print_success("Source URL updated to CDN URL")
            else:
                print_warning(f"Source URL still blob: {state_result.get('source_url', '')[:50]}...")
            
            if state_result.get("uploaded"):
                print_success("Paper marked as uploaded")
            else:
                print_warning("Paper not marked as uploaded")
        else:
            if state_result.get("deleted"):
                print_warning("Paper was deleted (likely by Rekognition)")
            else:
                print_error("Paper not found in database")
        
        # Step 3: Wait for Rekognition
        if state_result.get("found") and not state_result.get("deleted"):
            rekognition_result = await self.wait_for_rekognition(paper_id)
            result["rekognition"] = rekognition_result
            
            if rekognition_result.get("status") == "validated":
                print_success("Rekognition: Image is safe")
            elif rekognition_result.get("status") == "deleted":
                print_warning("Rekognition: Image was deleted (unsafe)")
            else:
                print_warning(f"Rekognition: Status unknown ({rekognition_result.get('status')})")
        
        result["success"] = (
            upload_result.get("success") and
            state_result.get("found") and
            state_result.get("is_cdn_url")
        )
        
        return result
    
    async def run_tests(self, images_folder: Path):
        """Run tests on all images in folder."""
        print_header("Image Upload Flow Integration Test")
        
        settings = get_settings()
        print_info(f"API URL: {self.api_base_url}")
        print_info(f"Test User ID: {self.test_user_id}")
        print_info(f"S3 Bucket: {settings.aws_s3_bucket_name}")
        print_info(f"CDN URL: {settings.cdn_base_url}")
        
        # Find all image files
        image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
        image_files = [
            f for f in images_folder.iterdir()
            if f.is_file() and f.suffix.lower() in image_extensions
        ]
        
        if not image_files:
            print_error(f"No image files found in {images_folder}")
            return
        
        print_info(f"Found {len(image_files)} image file(s)")
        
        # Create test orb
        orb_id = await self.create_test_orb()
        
        # Test each image
        for image_file in image_files:
            result = await self.test_image(image_file, orb_id)
            self.results.append(result)
            print()  # Blank line between tests
        
        # Print summary
        self.print_summary()
    
    def print_summary(self):
        """Print test summary."""
        print_header("Test Summary")
        
        total = len(self.results)
        successful = sum(1 for r in self.results if r.get("success"))
        failed = total - successful
        
        print_info(f"Total images tested: {total}")
        print_success(f"Successful: {successful}")
        if failed > 0:
            print_error(f"Failed: {failed}")
        
        print("\nDetailed Results:")
        for result in self.results:
            status = "✓" if result.get("success") else "✗"
            print(f"  {status} {result['image']}")
            
            if not result.get("success"):
                if not result.get("upload", {}).get("success"):
                    print(f"    - Upload failed: {result.get('upload', {}).get('error', 'Unknown error')}")
                elif not result.get("state_check", {}).get("is_cdn_url"):
                    print(f"    - CDN URL transition failed")
        
        # Rekognition summary
        validated = sum(1 for r in self.results if r.get("rekognition") and r.get("rekognition", {}).get("validated"))
        deleted = sum(1 for r in self.results if r.get("rekognition") and r.get("rekognition", {}).get("status") == "deleted")
        pending = total - validated - deleted
        
        if validated > 0 or deleted > 0 or pending > 0:
            print("\nRekognition Results:")
            if validated > 0:
                print_success(f"  Validated (safe): {validated}")
            if deleted > 0:
                print_warning(f"  Deleted (unsafe): {deleted}")
            if pending > 0:
                print_info(f"  Pending/Unknown: {pending}")


async def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python test_image_upload_flow.py <images_folder> [api_url] [auth_token]")
        print("Example: python test_image_upload_flow.py ./test_images http://localhost:8000")
        print("Example: python test_image_upload_flow.py ./test_images http://localhost:8000 <jwt_token>")
        sys.exit(1)
    
    images_folder = Path(sys.argv[1])
    if not images_folder.exists() or not images_folder.is_dir():
        print_error(f"Images folder not found: {images_folder}")
        sys.exit(1)
    
    api_url = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8000"
    auth_token = sys.argv[3] if len(sys.argv) > 3 else None
    
    if auth_token:
        # Validate token expiration before starting tests
        import json
        import base64
        try:
            parts = auth_token.split('.')
            if len(parts) == 3:
                payload_b64 = parts[1]
                padding = 4 - len(payload_b64) % 4
                if padding != 4:
                    payload_b64 += '=' * padding
                payload_bytes = base64.urlsafe_b64decode(payload_b64)
                payload = json.loads(payload_bytes.decode('utf-8'))
                exp = payload.get('exp')
                if exp:
                    import time
                    current_time = time.time()
                    if exp < current_time:
                        print_error(f"Token is EXPIRED! Expired {int((current_time - exp) / 60)} minutes ago.")
                        print_error("Please provide a fresh token from your Clerk session.")
                        sys.exit(1)
                    else:
                        minutes_remaining = int((exp - current_time) / 60)
                        print_info(f"Using provided JWT token (expires in {minutes_remaining} minutes)")
        except Exception as e:
            print_warning(f"Could not validate token expiration: {e}")
            print_info("Proceeding with provided token...")
    else:
        print_warning("No auth token provided - will use anonymous user if auth is disabled")
    
    tester = ImageUploadTester(api_base_url=api_url, auth_token=auth_token)
    await tester.run_tests(images_folder)


if __name__ == "__main__":
    # Fix for Windows: Use SelectorEventLoop instead of ProactorEventLoop
    # (required for psycopg async connections)
    import sys
    if sys.platform == "win32":
        import selectors
        loop = asyncio.SelectorEventLoop(selectors.SelectSelector())
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(main())
        finally:
            loop.close()
    else:
        asyncio.run(main())

