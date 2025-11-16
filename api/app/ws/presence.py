"""Presence tracking and view center management with throttling."""

import math
from collections import defaultdict
from time import time
from typing import Dict, Optional

from fastapi import WebSocket


class ViewCenterThrottler:
  """Throttles view center updates per user (max 2-3 per second)."""
  
  def __init__(self, max_updates_per_second: float = 2.5):
    self.max_updates_per_second = max_updates_per_second
    self.min_interval = 1.0 / max_updates_per_second
    # user_id -> last update timestamp
    self.last_update: Dict[str, float] = {}
  
  def should_update(self, user_id: str) -> bool:
    """Check if user should be allowed to send a view center update."""
    now = time()
    last = self.last_update.get(user_id, 0)
    
    if now - last >= self.min_interval:
      self.last_update[user_id] = now
      return True
    return False


def quantize_spherical(radius: float, phi: float, theta: float, precision: int = 2) -> Dict[str, float]:
  """
  Quantize spherical coordinates to reduce update frequency.
  
  Args:
    radius: Distance from center (1.6 to 6.0 typical)
    phi: Polar angle (0.001 to π-0.001, clamped by frontend)
    theta: Azimuthal angle (can be any value, will be normalized to 0-2π)
    precision: Number of decimal places (default 2 = ~0.57 degree precision)
  
  Returns:
    Quantized spherical coordinates with normalized theta
  """
  # Normalize theta to 0-2π range (matches THREE.Spherical standard)
  theta = normalize_theta(theta)
  
  return {
    "radius": round(radius, precision),
    "phi": round(phi, precision),
    "theta": round(theta, precision),
  }


def normalize_theta(theta: float) -> float:
  """Normalize theta angle to 0-2π range."""
  # Normalize to [0, 2π)
  while theta < 0:
    theta += 2 * math.pi
  while theta >= 2 * math.pi:
    theta -= 2 * math.pi
  return theta


def angular_distance(theta1: float, theta2: float) -> float:
  """
  Calculate shortest angular distance between two angles (handles wrapping).
  Returns distance in [0, π].
  """
  # Normalize both angles to [0, 2π)
  theta1 = normalize_theta(theta1)
  theta2 = normalize_theta(theta2)
  
  # Calculate both directions and take the shorter one
  diff = abs(theta1 - theta2)
  wrapped_diff = 2 * math.pi - diff
  return min(diff, wrapped_diff)


def spherical_distance(
  radius1: float, phi1: float, theta1: float,
  radius2: float, phi2: float, theta2: float
) -> float:
  """
  Calculate approximate distance between two spherical coordinates.
  Used to determine if update is significant enough to broadcast.
  Handles theta wrapping correctly.
  """
  radius_diff = abs(radius1 - radius2)
  phi_diff = abs(phi1 - phi2)
  theta_diff = angular_distance(theta1, theta2)
  
  # Weighted combination (angles in radians, radius in world units)
  # Scale angle differences to be comparable to radius differences
  angle_diff = math.sqrt(phi_diff ** 2 + theta_diff ** 2)
  return radius_diff + angle_diff * 0.1  # Scale angles to be less significant than radius


class PresenceTracker:
  """Tracks user presence and view centers per orb."""
  
  def __init__(self, min_update_distance: float = 0.01):
    """
    Args:
      min_update_distance: Minimum change required to broadcast update
    """
    self.min_update_distance = min_update_distance
    # orb_id -> user_id -> {radius, phi, theta}
    self.view_centers: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(dict)
    # user_id -> last view center (for change detection)
    self.last_view_centers: Dict[str, Dict[str, float]] = {}
  
  def update_view_center(
    self, orb_id: str, user_id: str, view_center: Dict[str, float]
  ) -> bool:
    """
    Update a user's view center.
    Returns True if update is significant enough to broadcast.
    """
    quantized = quantize_spherical(
      view_center["radius"],
      view_center["phi"],
      view_center["theta"]
    )
    
    # Check if update is significant
    last = self.last_view_centers.get(user_id)
    if last:
      distance = spherical_distance(
        quantized["radius"], quantized["phi"], quantized["theta"],
        last["radius"], last["phi"], last["theta"]
      )
      if distance < self.min_update_distance:
        return False  # Update too small, skip
    
    # Store update
    self.view_centers[orb_id][user_id] = quantized
    self.last_view_centers[user_id] = quantized
    return True
  
  def remove_user(self, orb_id: str, user_id: str):
    """Remove user's presence from an orb."""
    if orb_id in self.view_centers:
      self.view_centers[orb_id].pop(user_id, None)
      if not self.view_centers[orb_id]:
        del self.view_centers[orb_id]
    self.last_view_centers.pop(user_id, None)
  
  def get_view_centers(self, orb_id: str) -> Dict[str, Dict[str, float]]:
    """Get all view centers for an orb."""
    return self.view_centers.get(orb_id, {}).copy()

