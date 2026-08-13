import { useEffect, useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Center,
  Checkbox,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import { palette } from "@/app/theme/tokens";
import { RoutePath } from "@/constants";
import { useAuthStore } from "@/store/authStore";

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const token = useAuthStore((state) => state.token);
  const currentUser = useAuthStore((state) => state.currentUser);
  const rememberCredentials = useAuthStore((state) => state.rememberCredentials);
  const rememberedUsername = useAuthStore((state) => state.rememberedUsername);
  const rememberedPassword = useAuthStore((state) => state.rememberedPassword);
  const autoLoginPreference = useAuthStore((state) => state.autoLogin);

  const [username, setUsername] = useState(rememberedUsername);
  const [password, setPassword] = useState(rememberedPassword);
  const [remember, setRemember] = useState(rememberCredentials);
  const [autoLogin, setAutoLogin] = useState(autoLoginPreference);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (token && currentUser) {
      navigate(RoutePath.ROOT, { replace: true });
    }
  }, [currentUser, navigate, token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await login(
        {
          password,
          username,
        },
        {
          autoLogin: remember && autoLogin,
          rememberCredentials: remember,
        }
      );
      navigate(RoutePath.ROOT, { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Center
      h="100vh"
      style={{
        background: `radial-gradient(circle at top left, ${palette.accentSoft}, transparent 34%), ${palette.page}`,
      }}
    >
      <Paper maw={440} p="xl" radius="lg" shadow="sm" w="100%" withBorder>
        <Stack gap="lg">
          <Stack gap={4}>
            <Text c={palette.accent} fw={700} size="sm" tt="uppercase">
              QAA-TMS
            </Text>
            <Title order={2}>Sign in</Title>
            <Text c="dimmed" size="sm">
              Use admin / admin for the administrator or test with an empty password.
            </Text>
          </Stack>

          {errorMessage ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title="Login failed">
              {errorMessage}
            </Alert>
          ) : null}

          <form onSubmit={(event) => void handleSubmit(event)}>
            <Stack gap="md">
              <TextInput
                autoComplete="username"
                label="Username"
                onChange={(event) => setUsername(event.currentTarget.value)}
                placeholder="Enter your username"
                required
                value={username}
              />

              <PasswordInput
                autoComplete="current-password"
                label="Password"
                onChange={(event) => setPassword(event.currentTarget.value)}
                placeholder="Enter your password"
                value={password}
              />

              <Checkbox
                checked={remember}
                label="Remember login and password"
                onChange={(event) => {
                  const nextRemember = event.currentTarget.checked;
                  setRemember(nextRemember);
                  if (!nextRemember) {
                    setAutoLogin(false);
                  }
                }}
              />

              <Checkbox
                checked={autoLogin}
                disabled={!remember}
                label="Log in automatically"
                onChange={(event) => setAutoLogin(event.currentTarget.checked)}
              />

              <Button loading={isSubmitting} size="md" type="submit">
                Sign in
              </Button>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Center>
  );
}
