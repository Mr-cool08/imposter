import os

from app import create_app
from app.config import env_flag, env_int


def main() -> None:
    app = create_app()
    app.extensions["socketio"].run(
        app,
        host=os.getenv("HOST", "127.0.0.1"),
        port=env_int("PORT", 5000),
        debug=env_flag("IMPOSTER_DEBUG"),
        use_reloader=False,
        allow_unsafe_werkzeug=True,
    )


if __name__ == "__main__":
    main()
