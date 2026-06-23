import random
from datetime import datetime, timedelta


def get_controller_data():
    venues = [
        {
            "network_id": "net_001",
            "name": "The Anchor",
            "city": "London",
            "country": "UK",
        },
        {
            "network_id": "net_002",
            "name": "Brew & Co",
            "city": "Manchester",
            "country": "UK",
        },
        {
            "network_id": "net_003",
            "name": "Eastside Hotel Lobby",
            "city": "Birmingham",
            "country": "UK",
        },
    ]

    access_points = [
        {
            "mac": "ap:aa:01",
            "name": "AP-Floor1",
            "model": "Meraki MR36",
            "venue_network_id": "net_001",
        },
        {
            "mac": "ap:aa:02",
            "name": "AP-Floor2",
            "model": "Meraki MR36",
            "venue_network_id": "net_001",
        },
        {
            "mac": "ap:bb:01",
            "name": "AP-Main",
            "model": "Meraki MR44",
            "venue_network_id": "net_002",
        },
        {
            "mac": "ap:bb:02",
            "name": "AP-Mezzanine",
            "model": "Meraki MR44",
            "venue_network_id": "net_002",
        },
        {
            "mac": "ap:cc:01",
            "name": "AP-Lobby",
            "model": "Meraki MR36",
            "venue_network_id": "net_003",
        },
        {
            "mac": "ap:cc:02",
            "name": "AP-Lounge",
            "model": "Meraki MR36",
            "venue_network_id": "net_003",
        },
    ]

    device_types = ["iPhone", "Android", "MacBook", "Windows laptop", "iPad"]

    venue_configs = [
        {
            "count_range": (15, 25),
            "aps": ["ap:aa:01", "ap:aa:02"],
            "peak_hours": {17, 18, 19, 20, 21, 22},
            "duration_buckets": [(20, 120, 480), (60, 1800, 5400), (20, 7200, 14400)],
        },
        {
            "count_range": (20, 30),
            "aps": ["ap:bb:01", "ap:bb:02"],
            "peak_hours": {8, 9, 10, 11, 13, 14, 15, 16},
            "duration_buckets": [(10, 120, 300), (30, 1800, 3600), (60, 5400, 14400)],
        },
        {
            "count_range": (10, 15),
            "aps": ["ap:cc:01", "ap:cc:02"],
            "peak_hours": set(range(24)),
            "duration_buckets": [(35, 120, 600), (45, 1800, 5400), (20, 7200, 18000)],
        },
    ]

    def random_client_mac():
        return ":".join(
            ["cl"] + [f"{random.randint(0, 255):02x}" for _ in range(3)]
        )

    def random_connected_at(peak_hours):
        days_ago = random.randint(0, 6)
        hours = list(range(24))
        if peak_hours == set(range(24)):
            hour = random.choice(hours)
        else:
            weights = [5 if h in peak_hours else 1 for h in hours]
            hour = random.choices(hours, weights=weights, k=1)[0]
        minute = random.randint(0, 59)
        second = random.randint(0, 59)
        day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        day -= timedelta(days=days_ago)
        return day.replace(hour=hour, minute=minute, second=second).isoformat()

    def random_duration(buckets):
        weights = [bucket[0] for bucket in buckets]
        lo, hi = random.choices(buckets, weights=weights, k=1)[0][1:]
        return random.randint(lo, hi)

    sessions = []
    for config in venue_configs:
        count = random.randint(*config["count_range"])
        for _ in range(count):
            sessions.append(
                {
                    "client_mac": random_client_mac(),
                    "device_type": random.choice(device_types),
                    "duration_seconds": random_duration(config["duration_buckets"]),
                    "connected_at": random_connected_at(config["peak_hours"]),
                    "ap_mac": random.choice(config["aps"]),
                }
            )

    return {
        "venues": venues,
        "access_points": access_points,
        "sessions": sessions,
    }
