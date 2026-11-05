import pytest

from app.rules.flags import FlagEvaluationError, evaluate_result, safe_evaluate_result


def test_hb_low_value():
    assert evaluate_result(10.2, '12.0-15.5', 'haemoglobin') == 'low'


def test_ldl_high_value():
    assert evaluate_result(142, '0-100', 'ldl') == 'high'


def test_potassium_critical_value():
    assert evaluate_result(6.8, '3.5-5.1', 'potassium') == 'critical'


def test_boundary_values_are_normal():
    assert evaluate_result(12.0, '12.0-15.5', 'haemoglobin') == 'normal'
    assert evaluate_result(15.5, '12.0-15.5', 'haemoglobin') == 'normal'
    assert evaluate_result(100, '0-100', 'ldl') == 'normal'


def test_bad_input_raises_typed_error_and_manual_review():
    with pytest.raises(FlagEvaluationError):
        evaluate_result('Negative', '3.5-5.1', 'potassium')

    assert safe_evaluate_result('Negative', '3.5-5.1', 'potassium') == 'needs manual review'
