#!/usr/bin/env python3
"""
Probes: Ensuring spec_quality bounds are restored independently of agent interpretation.
Rule: Q-ULTRA-spec_quality-REDESIGN
"""

def check_probe_defect_exists(spec_state):
    """
    A probe fails while the defect exists if spec_state is out of bounds.
    The 'vacuous' status indicates the previous probe never failed on this item.
    """
    # Assume bounds are 0.0 to 100.0
    # Defect: agent misreading causes out-of-bounds deviation
    if not (0.0 <= spec_state['value'] <= 100.0):
        return True  # Probe fails (False/Negative is fail)
    return False  # Probe passes (Positive is pass) if bounds are met

def test_vacuous_probe_behavior():
    # Simulate the defect state where work is out of bounds
    out_of_bounds = {"value": 150.0}
    
    # The probe MUST return False (failure) here to demonstrate the defect is active
    is_defect_active = check_probe_defect_exists(out_of_bounds)
    
    assert not is_defect_active, "Probe MUST fail while the defect (out of bounds) exists"
    print("Probe correctly fails on defect: PASSED")

if __name__ == "__main__":
    test_vacuous_probe_behavior()
