FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY src src
RUN mkdir build && javac --release 21 --add-modules jdk.httpserver -encoding UTF-8 -d build src/balloon/*.java
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/build build
COPY web web
COPY config config
RUN mkdir data && chown -R 10001:10001 /app
USER 10001
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["java", "--add-modules", "jdk.httpserver", "-cp", "build", "balloon.Server"]
