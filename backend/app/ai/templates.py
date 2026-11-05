from __future__ import annotations

LOCKED_TEMPLATES = {
    'haemoglobin': {
        'low': {'en': 'Your haemoglobin is low. Please discuss this with your doctor.', 'te': 'మీ రక్త హిమోగ్లోబిన్ తక్కువ ఉంది. దయచేసి మీ వైద్యుడిని సంప్రదించండి.', 'hi': 'आपका हीमोग्लोबिन कम है। कृपया अपने डॉक्टर से चर्चा करें।'},
        'high': {'en': 'Your haemoglobin is above the usual range. Please discuss this with your doctor.', 'te': 'మీ హిమోగ్లోబిన్ సాధారణ పరిధి కంటే ఎక్కువ ఉంది. దయచేసి మీ వైద్యుడిని సంప్రదించండి.', 'hi': 'आपका हीमोग्लोबिन सामान्य सीमा से अधिक है। कृपया अपने डॉक्टर से चर्चा करें।'}
    },
    'potassium': {
        'low': {'en': 'Your potassium is low. Please discuss this with your doctor.', 'te': 'మీ పొటాషియం తక్కువ ఉంది. దయచేసి మీ వైద్యుడిని సంప్రదించండి.', 'hi': 'आपका पोटेशियम कम है। कृपया अपने डॉक्टर से चर्चा करें।'},
        'high': {'en': 'Your potassium is high. Please discuss this with your doctor.', 'te': 'మీ పొటాషియం ఎక్కువ ఉంది. దయచేసి మీ వైద్యుడిని సంప్రదించండి.', 'hi': 'आपका पोटेशियम अधिक है। कृपया अपने डॉक्टर से चर्चा करें।'}
    },
    'ldl': {
        'high': {'en': 'Your LDL is high. Please discuss this with your doctor.', 'te': 'మీ LDL ఎక్కువ ఉంది. దయచేసి మీ వైద్యుడిని సంప్రదించండి.', 'hi': 'आपका LDL अधिक है। कृपया अपने डॉक्टर से चर्चा करें।'}
    },
}


def get_template(parameter: str, direction: str, language: str) -> str | None:
    param_key = parameter.strip().lower().replace(' ', '')
    by_param = LOCKED_TEMPLATES.get(param_key)
    if not by_param:
        return None
    return by_param.get(direction.lower(), {}).get(language.lower())
