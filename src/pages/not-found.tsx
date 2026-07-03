import { ErrorLayout } from '@/components/error-layout';

export default function NotFoundPage() {
  return (
    <ErrorLayout
      code="404"
      title="Page not found"
      message="The page you're looking for doesn't exist or may have moved."
    />
  );
}
