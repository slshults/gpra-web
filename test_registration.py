#!/usr/bin/env python3
"""Quick registration form test with reCAPTCHA fixes"""

from playwright.sync_api import sync_playwright
import time
import sys

def test_registration():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()

        try:
            # Step 1-2: Navigate and screenshot login page
            print("1. Navigating to login page...")
            page.goto("http://localhost:5000/login/")
            page.wait_for_load_state("networkidle")
            page.screenshot(path="/home/steven/webdev/guitar/practice/gprweb/test_login_page.png")
            print("   Screenshot saved: test_login_page.png")

            # Step 3-4: Click Sign Up and screenshot registration form
            print("2. Looking for Sign Up link...")
            signup_link = page.get_by_role("link", name="Sign Up")
            if not signup_link.is_visible():
                signup_link = page.get_by_text("Sign Up")
            signup_link.click()
            page.wait_for_load_state("networkidle")
            page.screenshot(path="/home/steven/webdev/guitar/practice/gprweb/test_registration_form.png")
            print("   Screenshot saved: test_registration_form.png")

            # Step 5: Fill in registration form
            print("3. Filling in registration form...")
            page.get_by_label("User Name").fill("testuser3")
            page.get_by_label("First Name").fill("Test")
            page.get_by_label("Last Name").fill("Three")
            page.get_by_label("Email").fill("testuser3@example.com")
            page.get_by_label("Password", exact=True).fill("TestPass123!")
            page.get_by_label("Confirm Password").fill("TestPass123!")

            # Step 6: Submit and screenshot result
            print("4. Submitting form...")
            page.get_by_role("button", name="Sign Up").click()
            time.sleep(2)  # Wait for response
            page.screenshot(path="/home/steven/webdev/guitar/practice/gprweb/test_registration_result.png")
            print("   Screenshot saved: test_registration_result.png")

            # Check for success or error messages
            page_content = page.content()
            if "successfully" in page_content.lower():
                print("   ✓ Success message detected")
            elif "error" in page_content.lower():
                print("   ✗ Error message detected")

            print("\n5. Browser left open for inspection. Press Ctrl+C to close.")
            input("Press Enter to close browser...")

        except Exception as e:
            print(f"✗ Error during test: {e}")
            page.screenshot(path="/home/steven/webdev/guitar/practice/gprweb/test_error.png")
            print("   Error screenshot saved: test_error.png")
            raise
        finally:
            browser.close()

if __name__ == "__main__":
    test_registration()
