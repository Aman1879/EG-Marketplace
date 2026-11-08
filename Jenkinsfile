pipeline {
    agent any

    tools {
        nodejs 'NodeJS-18'
    }

    environment {
        CI = 'true'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                echo 'Installing backend and frontend dependencies...'
                sh '''
                    cd backend && npm ci
                    cd ../frontend && npm ci
                '''
            }
        }

        stage('Backend Integration Tests') {
            steps {
                echo 'Running Phase 16 & automated verification test suite...'
                sh '''
                    cd backend && npm run test:phase16
                '''
            }
        }

        stage('Build Frontend Production Artifacts') {
            steps {
                echo 'Compiling frontend Vite production bundle...'
                sh '''
                    cd frontend && npm run build
                '''
            }
        }

        stage('Deploy Frontend Website') {
            steps {
                echo 'Deploying compiled frontend bundle to web root...'
                sh '''
                    if [ -d "/var/www/html" ]; then
                        sudo rm -rf /var/www/html/*
                        sudo cp -r frontend/dist/* /var/www/html/
                        echo "Frontend deployed to /var/www/html successfully."
                    else
                        echo "Web directory /var/www/html does not exist on this agent; skipping local web root copy."
                    fi
                '''
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            echo 'CI/CD Pipeline completed successfully.'
        }
        failure {
            echo 'CI/CD Pipeline failed. Please check build logs.'
        }
    }
}
