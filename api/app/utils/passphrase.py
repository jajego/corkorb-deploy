"""
Generate cute random passphrases for orb IDs.
Uses a combination of adjectives and nouns to create memorable IDs.
Format: adjective-adjective-noun (e.g., "cosmic-starry-orb", "luminous-peaceful-sphere")
"""

import random
from typing import List, Optional

ADJECTIVES = [
    # Cosmic & Celestial
    'cosmic', 'starry', 'luminous', 'radiant', 'celestial', 'ethereal', 'mystic',
    'nebular', 'galactic', 'stellar', 'astral', 'solar', 'lunar', 'planetary',
    'constellation', 'nebula', 'aurora', 'comet', 'meteor', 'quasar',
    
    # Light & Glow
    'bright', 'shiny', 'glowing', 'sparkling', 'twinkling', 'dazzling', 'gleaming',
    'glimmering', 'shimmering', 'radiant', 'brilliant', 'luminous', 'incandescent',
    'iridescent', 'lustrous', 'polished', 'glossy', 'phosphorescent',
    
    # Magical & Enchanted
    'magical', 'enchanted', 'whimsical', 'mystical', 'mysterious', 'arcane', 'esoteric',
    'supernatural', 'transcendent', 'divine', 'sacred', 'holy', 'blessed',
    'bewitched', 'spellbound', 'mesmerizing', 'captivating', 'alluring', 'entrancing',
    
    # Emotional & Mood
    'serene', 'peaceful', 'gentle', 'calm', 'tranquil', 'zen', 'meditative',
    'dreamy', 'whimsical', 'playful', 'cheerful', 'joyful', 'merry', 'jubilant',
    'euphoric', 'blissful', 'ecstatic', 'harmonious', 'balanced', 'unified',
    'tender', 'sweet', 'kind', 'friendly', 'warm', 'cozy', 'snug', 'comfy',
    'welcoming', 'inviting', 'comforting', 'soothing', 'relaxing', 'restful',
    
    # Beautiful & Aesthetic
    'gorgeous', 'beautiful', 'lovely', 'charming', 'elegant', 'graceful', 'refined',
    'cute', 'adorable', 'precious', 'delightful', 'enchanting', 'captivating',
    'stunning', 'breathtaking', 'magnificent', 'splendid', 'majestic', 'regal',
    'exquisite', 'delicate', 'fine', 'subtle', 'sophisticated', 'polished',
    
    # Movement & Flow
    'flowing', 'swirling', 'dancing', 'floating', 'soaring', 'flying', 'gliding',
    'spiraling', 'whirling', 'twirling', 'rotating', 'spinning', 'revolving',
    'undulating', 'waving', 'rippling', 'pulsing', 'throbbing', 'beating',
    
    # Color & Texture
    'velvety', 'silky', 'smooth', 'soft', 'plush', 'cushiony', 'downy',
    'crystalline', 'glassy', 'translucent', 'transparent', 'opalescent',
    'pearly', 'mother-of-pearl', 'iridescent', 'rainbow', 'prismatic',
    'vibrant', 'vivid', 'rich', 'saturated', 'intense', 'bold', 'striking',
    
    # Nature & Organic
    'organic', 'natural', 'wild', 'untamed', 'primal', 'elemental', 'earthy',
    'mossy', 'leafy', 'floral', 'blooming', 'budding', 'flourishing', 'thriving',
    'verdant', 'lush', 'fertile', 'abundant', 'plentiful', 'bountiful',
    
    # Abstract & Conceptual
    'eternal', 'infinite', 'timeless', 'endless', 'boundless', 'limitless',
    'profound', 'deep', 'meaningful', 'significant', 'important', 'valuable',
    'precious', 'rare', 'unique', 'special', 'extraordinary', 'remarkable',
    'wondrous', 'marvelous', 'fantastic', 'fabulous', 'amazing', 'incredible',
]

NOUNS = [
    # Primary Orb/Sphere Shapes (most orb/sphere-related)
    'orb', 'sphere', 'globe', 'ball', 'bubble', 'bead', 'pellet', 'marble',
    'pearl', 'droplet', 'globule', 'spherule', 'orbicle', 'spheroid',
    'ellipsoid', 'ovoid', 'round', 'circle', 'ring', 'disc', 'disk', 'wheel',
    'loop', 'hoop', 'coil', 'spiral', 'helix', 'whorl', 'volute', 'torus',
    'donut', 'bagel', 'tire', 'globoid', 'roundel', 'circlet',
    
    # Celestial Bodies (spherical objects in space)
    'star', 'planet', 'moon', 'sun', 'satellite', 'asteroid', 'comet',
    'meteor', 'meteorite', 'nebula', 'galaxy', 'constellation', 'cosmos',
    'universe', 'quasar', 'pulsar', 'blackhole', 'white-dwarf', 'red-giant',
    'supernova', 'neutron-star', 'dwarf-planet', 'exoplanet',
    
    # Gems & Crystals (often spherical or rounded)
    'gem', 'jewel', 'crystal', 'diamond', 'emerald', 'ruby', 'sapphire',
    'amethyst', 'topaz', 'opal', 'quartz', 'agate', 'jade', 'amber',
    'coral', 'ivory', 'onyx', 'jasper', 'garnet', 'tourmaline',
    'beryl', 'zircon', 'peridot', 'citrine', 'aquamarine', 'moonstone',
    'rose-quartz', 'smoky-quartz', 'tanzanite', 'kunzite',
    
    # Light & Energy (often spherical or circular)
    'light', 'glow', 'shine', 'beam', 'ray', 'spark', 'flash', 'gleam',
    'twinkle', 'glimmer', 'shimmer', 'flicker', 'flare', 'burst', 'explosion',
    'aurora', 'halo', 'corona', 'nimbus', 'aureole', 'luminescence',
    'phosphorescence', 'bioluminescence', 'incandescence', 'radiance',
    
    # Natural Spheres (round objects from nature)
    'dew', 'rain', 'hail', 'snow', 'ice', 'frost', 'foam', 'froth', 'lather',
    'soap-bubble', 'air-bubble', 'egg', 'seed', 'nut', 'berry', 'fruit',
    'apple', 'orange', 'cherry', 'grape', 'plum', 'peach', 'tomato',
    'onion', 'potato', 'turnip', 'coconut', 'walnut', 'hazelnut', 'chestnut',
    
    # Abstract Concepts (conceptual centers/orbs)
    'dream', 'vision', 'wish', 'hope', 'joy', 'peace', 'love', 'harmony',
    'balance', 'unity', 'serenity', 'calm', 'zen', 'flow', 'energy',
    'spirit', 'soul', 'essence', 'core', 'heart', 'center', 'hub', 'focus',
    'nexus', 'node', 'pivot', 'axis', 'pole', 'zenith', 'nadir',
    
    # Geometric Shapes (3D spherical shapes)
    'polyhedron', 'tetrahedron', 'octahedron', 'dodecahedron', 'icosahedron',
    'hemisphere', 'semicircle', 'arc', 'curve', 'arch', 'vault',
    
    # Mystical & Magical (orb-like objects)
    'crystal-ball', 'talisman', 'amulet', 'charm', 'totem', 'fetish',
    'relic', 'artifact', 'token', 'sigil', 'rune', 'symbol', 'glyph',
    'mark', 'seal', 'emblem',
    
    # Organic & Biological (cellular/spherical structures)
    'cell', 'nucleus', 'organelle', 'vesicle', 'vacuole', 'granule',
    'pollen', 'spore', 'ovum', 'embryo', 'bud', 'bulb', 'tuber', 'nodule',
    'knob', 'bump', 'protuberance', 'swelling', 'tumor', 'cyst',
    
    # Water & Fluid (spherical drops)
    'tear', 'blob', 'spray', 'mist', 'fog', 'vapor', 'steam', 'cloud',
    'haze', 'smoke', 'smog', 'condensation', 'precipitation',
    
    # Earth & Minerals (round stones/particles)
    'stone', 'rock', 'pebble', 'boulder', 'cobble', 'gravel', 'sand',
    'grain', 'particle', 'speck', 'mote', 'atom', 'molecule',
    'mineral', 'ore', 'treasure', 'hoard', 'cache',
    
    # Light & Optical (spherical/circular optical elements)
    'prism', 'lens', 'magnifier', 'telescope', 'microscope', 'mirror',
    'reflection', 'refraction', 'diffraction', 'interference', 'polarization',
    'spectrum', 'rainbow', 'bow', 'iris', 'pupil',
]


def generate_passphrase() -> str:
    """
    Generate a cute random passphrase for an orb ID.
    Format: adjective-adjective-noun (e.g., "cosmic-starry-orb", "luminous-peaceful-sphere")
    
    Returns:
        A cute passphrase string
    """
    # Select two different adjectives
    adjective1 = random.choice(ADJECTIVES)
    adjective2 = random.choice(ADJECTIVES)
    # Ensure they're different (if same, try again)
    while adjective2 == adjective1 and len(ADJECTIVES) > 1:
        adjective2 = random.choice(ADJECTIVES)
    
    noun = random.choice(NOUNS)
    return f"{adjective1}-{adjective2}-{noun}"


def generate_unique_passphrase(existing_ids: Optional[List[str]] = None) -> str:
    """
    Generate a unique passphrase by checking against existing IDs.
    
    Args:
        existing_ids: Optional list of existing IDs to check against
        
    Returns:
        A unique passphrase string
    """
    if existing_ids is None:
        existing_ids = []
    
    # Convert to set for faster lookup
    existing_set = set(existing_ids)
    max_attempts = 100
    
    # First, try simple passphrase
    passphrase = generate_passphrase()
    attempts = 0
    
    while passphrase in existing_set and attempts < max_attempts:
        # If collision, try a new passphrase
        passphrase = generate_passphrase()
        attempts += 1
    
    # If still not unique after max attempts, append a random number
    if passphrase in existing_set:
        base_passphrase = generate_passphrase()
        random_suffix = random.randint(1000, 9999)
        passphrase = f"{base_passphrase}-{random_suffix}"
        attempts = 0
        
        # Keep trying with suffix until unique
        while passphrase in existing_set and attempts < max_attempts:
            base_passphrase = generate_passphrase()
            random_suffix = random.randint(1000, 9999)
            passphrase = f"{base_passphrase}-{random_suffix}"
            attempts += 1
    
    # If still not unique, append timestamp as last resort
    if passphrase in existing_set:
        import time
        base_passphrase = generate_passphrase()
        timestamp = int(time.time()) % 10000
        passphrase = f"{base_passphrase}-{timestamp}"
    
    return passphrase

