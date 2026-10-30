from dataclasses import replace

from experiment import uncertainty_trials
from model import Config, Leg, make_route


def test_seeded_fixed_plan_trials_and_zero_noise():
    cfg = Config(width_m=1000,height_m=1000,base=(500,1000))
    route = make_route(1,(Leg(cfg.base,(500,0),True),Leg((500,0),cfg.base,True)),cfg)
    a, rows_a = uncertainty_trials((route,),(route,),cfg,trials=5,seed=2)
    b, rows_b = uncertainty_trials((route,),(route,),cfg,trials=5,seed=2)
    assert a == b and rows_a == rows_b
    assert all(r["optimized_makespan_s"] == r["baseline_makespan_s"] for r in rows_a)
    _, exact = uncertainty_trials((route,),None,cfg,trials=1,wind_sd_mps=0,airspeed_sd_mps=0,log_power_sd=0)
    assert exact[0]["optimized_makespan_s"] == route.time_s
    assert exact[0]["optimized_max_energy_wh"] == route.energy_wh


def test_trial_battery_failures_are_counted_not_discarded():
    cfg = Config(width_m=1000,height_m=1000,base=(500,1000),battery_wh=.01)
    route = make_route(1,(Leg(cfg.base,(500,0),True),Leg((500,0),cfg.base,True)),cfg)
    summary, rows = uncertainty_trials((route,),None,cfg,trials=3,wind_sd_mps=0,airspeed_sd_mps=0,log_power_sd=0)
    assert summary["optimized"]["infeasible_trials"] == 3
    assert summary["optimized"]["makespan_percentiles_s_given_feasible"] is None
    assert all(not r["optimized_feasible"] for r in rows)
