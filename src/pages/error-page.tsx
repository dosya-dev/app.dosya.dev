import { useRouteError, isRouteErrorResponse } from 'react-router-dom';
import { ErrorLayout } from '@/components/error-layout';

// Router errorElement — renders for thrown render/loader errors (and 404 route responses).
export default function ErrorPage() {
  const err = useRouteError();

  if (isRouteErrorResponse(err) && err.status === 404) {
    return (
      <ErrorLayout code="404" title="Page not found" message="The page you're looking for doesn't exist or may have moved." />
    );
  }

  return (
    <ErrorLayout
      code="500"
      title="Something went wrong"
      message="An unexpected error occurred. We've been notified and are looking into it — please try again."
    />
  );
}
