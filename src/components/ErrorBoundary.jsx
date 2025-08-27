import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    // optional: send to logging
    // console.error('Annotator crashed:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ border: '1px solid #a00', padding: 12, borderRadius: 8 }}>
          <strong>Annotation tool failed to load.</strong>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            You can still fill in job details and save the survey.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
