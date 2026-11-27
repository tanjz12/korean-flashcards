import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { styles } from "../styles/appStyles";

export function AuthPanel({ session, progressCount, dueCount, onBeforeSignOut, onError }) {
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState("");

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthMsg("");
    onError?.("");

    const cleanEmail = email.trim();
    if (!cleanEmail || password.length < 6) {
      setAuthMsg("Enter a valid email and a password of at least 6 characters.");
      return;
    }

    setAuthBusy(true);
    try {
      if (authMode === "register") {
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpErr) {
          setAuthMsg(signUpErr.message);
        } else if (data.session) {
          setAuthMsg("Account created and signed in.");
          setPassword("");
        } else {
          setAuthMsg("Registration successful. Check your email to confirm your account, then sign in.");
          setPassword("");
        }
      } else {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signInErr) {
          setAuthMsg(signInErr.message);
        } else {
          setAuthMsg("");
          setPassword("");
        }
      }
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <section style={styles.authBox}>
      {session?.user ? (
        <div style={styles.authLoggedIn}>
          <div style={styles.authText}>
            Signed in as <strong>{session.user.email}</strong> · {progressCount} studied ·{" "}
            <strong>{dueCount}</strong> due
          </div>
          <button
            type="button"
            onClick={async () => {
              await onBeforeSignOut?.();
              await supabase.auth.signOut();
            }}
            style={styles.smallBtn}
          >
            Sign Out
          </button>
        </div>
      ) : (
        <div>
          <div style={styles.authTabs}>
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setAuthMsg("");
              }}
              style={authMode === "login" ? styles.activeTab : styles.tab}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("register");
                setAuthMsg("");
              }}
              style={authMode === "register" ? styles.activeTab : styles.tab}
            >
              Register Account
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} style={styles.authForm}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.authInput}
              autoComplete="email"
            />
            <input
              type="password"
              placeholder="Password (min 6 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.authInput}
              autoComplete={authMode === "register" ? "new-password" : "current-password"}
            />
            <button type="submit" disabled={authBusy} style={styles.primarySmallBtn}>
              {authBusy ? "Working..." : authMode === "register" ? "Create Account" : "Sign In"}
            </button>
          </form>
          {authMsg && <div style={styles.authStatus}>{authMsg}</div>}
        </div>
      )}
    </section>
  );
}
