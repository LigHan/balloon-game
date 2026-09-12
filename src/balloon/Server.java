package balloon;

import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import static balloon.Json.*;

public final class Server {
    private final Game game;
    private final Path web;
    private final String adminPassword;
    private final Set<String> admins=ConcurrentHashMap.newKeySet();
    private final Map<String,List<Long>> loginAttempts=new ConcurrentHashMap<>();
    private final String csrfSecret;
    private Server(Game game,Path web,Path data)throws IOException{
        this.game=game;this.web=web.toAbsolutePath().normalize();
        this.adminPassword=System.getenv().getOrDefault("ADMIN_PASSWORD","admin-demo-2026");
        Path secret=data.resolve("csrf-secret.txt");
        if(!Files.exists(secret)){byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);Game.atomicWrite(secret,HexFormat.of().formatHex(bytes));}
        csrfSecret=Files.readString(secret).strip();
    }
    public static void main(String[] args)throws Exception{
        Path root=Path.of(System.getProperty("balloon.root",".")).toAbsolutePath().normalize();
        Path config=Path.of(System.getenv().getOrDefault("GAME_CONFIG",root.resolve("config/game.json").toString()));
        Path data=Path.of(System.getenv().getOrDefault("GAME_DATA",root.resolve("data").toString()));
        boolean dev="1".equals(System.getenv("GAME_DEV_MODE"));
        String seed=dev?System.getenv().getOrDefault("GAME_DEV_SEED",""):"";
        Game game=new Game(config,data,System::currentTimeMillis,dev,seed);
        Server app=new Server(game,root.resolve("web"),data);
        String host=System.getenv().getOrDefault("HOST","127.0.0.1");int port=Integer.parseInt(System.getenv().getOrDefault("PORT","8080"));
        HttpServer server=HttpServer.create(new InetSocketAddress(host,port),64);
        server.createContext("/",app::handle);server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
        timer.scheduleAtFixedRate(()->{try{game.tick();}catch(Exception e){System.err.println("Game tick failed: "+e.getMessage());}},100,100,TimeUnit.MILLISECONDS);
        Runtime.getRuntime().addShutdownHook(new Thread(()->{timer.shutdownNow();server.stop(1);}));
        server.start();System.out.println("Воздушный шар: http://"+host+":"+port+"\nАдминка: http://"+host+":"+port+"/admin\nРежим: "+(dev?"демонстрационный, доступны управляемые сценарии":"случайные серверные раунды"));
    }
    private void handle(HttpExchange x)throws IOException{
        try{
            x.getResponseHeaders().set("X-Content-Type-Options","nosniff");
            x.getResponseHeaders().set("Referrer-Policy","same-origin");
            x.getResponseHeaders().set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
            String path=x.getRequestURI().getPath();
            if(path.equals("/health")){send(x,200,map("status","ok"));return;}
            if(!path.startsWith("/api/")){staticFile(x,path);return;}
            x.getResponseHeaders().set("Cache-Control","no-store");
            String id=cookie(x,"balloon_sid");
            if(id==null||!game.hasPlayer(id)){id=game.newPlayer();setCookie(x,id);}
            String csrf=Game.sha256(csrfSecret+":"+id);String method=x.getRequestMethod();
            if(!method.equals("GET")){
                if(!method.equals("POST")){send(x,405,map("error","Метод не поддерживается"));return;}
                String origin=x.getRequestHeaders().getFirst("Origin"),host=x.getRequestHeaders().getFirst("Host");
                if((origin!=null&&!origin.equals("http://"+host)&&!origin.equals("https://"+host))||"cross-site".equals(x.getRequestHeaders().getFirst("Sec-Fetch-Site"))||!equal(csrf,x.getRequestHeaders().getFirst("X-CSRF-Token"))){send(x,403,map("error","Обновите страницу и повторите действие"));return;}
            }
            if(path.equals("/api/state")&&method.equals("GET")){Map<String,Object> state=game.state(id);state.put("csrf",csrf);send(x,200,state);return;}
            if(path.equals("/api/rounds")&&method.equals("POST")){
                Map<String,Object> b=body(x);only(b,"theme","tier","requestId");
                int tier=Config.integer(b,"tier",0,3);send(x,200,game.start(id,textField(b,"theme"),tier,textField(b,"requestId")));return;
            }
            if(path.matches("/api/rounds/[a-zA-Z0-9-]+/cashout")&&method.equals("POST")){Map<String,Object>b=body(x);only(b);send(x,200,game.cashout(id,path.split("/")[3]));return;}
            if(path.matches("/api/rounds/[a-zA-Z0-9-]+/proof")&&method.equals("GET")){send(x,200,game.proof(path.split("/")[3]));return;}
            if(path.equals("/api/profile")&&method.equals("POST")){Map<String,Object>b=body(x);only(b,"name");game.rename(id,textField(b,"name"));send(x,200,map("ok",true));return;}
            if(path.equals("/api/topup")&&method.equals("POST")){only(body(x));game.topup(id);send(x,200,map("ok",true));return;}
            if(path.equals("/api/new-session")&&method.equals("POST")){only(body(x));admins.remove(id);String next=game.newPlayer();setCookie(x,next);send(x,200,map("ok",true));return;}
            if(path.equals("/api/admin/login")&&method.equals("POST")){
                Map<String,Object>b=body(x);only(b,"password");long now=System.currentTimeMillis();
                List<Long> attempts=loginAttempts.computeIfAbsent(id,k->new ArrayList<>());
                synchronized(attempts){attempts.removeIf(t->now-t>60000);if(attempts.size()>=5){send(x,429,map("error","Слишком много попыток. Подождите минуту."));return;}attempts.add(now);}
                if(!equal(adminPassword,textField(b,"password"))){send(x,401,map("error","Неверный пароль"));return;}
                admins.add(id);send(x,200,game.admin());return;
            }
            if(path.startsWith("/api/admin/")){
                if(!admins.contains(id)){send(x,401,map("error","Войдите в панель управления"));return;}
                if(path.equals("/api/admin/config")&&method.equals("GET")){send(x,200,game.admin());return;}
                if(path.equals("/api/admin/config")&&method.equals("POST")){game.updateConfig(body(x));send(x,200,game.admin());return;}
                if(path.equals("/api/admin/scenario")&&method.equals("POST")){Map<String,Object>b=body(x);only(b,"scenario");game.setNextScenario(id,textField(b,"scenario"));send(x,200,map("ok",true));return;}
                if(path.equals("/api/admin/logout")&&method.equals("POST")){only(body(x));admins.remove(id);send(x,200,map("ok",true));return;}
            }
            send(x,404,map("error","Адрес не найден"));
        }catch(IllegalArgumentException e){send(x,400,map("error",e.getMessage()));}
        catch(Exception e){System.err.println("Request failed: "+e);send(x,500,map("error","Не удалось выполнить действие. Обновите страницу, чтобы проверить состояние."));}
        finally{x.close();}
    }
    private static boolean equal(String a,String b){return b!=null&&MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),b.getBytes(StandardCharsets.UTF_8));}
    private static String cookie(HttpExchange x,String key){String raw=x.getRequestHeaders().getFirst("Cookie");if(raw!=null)for(String part:raw.split(";")){String[] pair=part.strip().split("=",2);if(pair.length==2&&pair[0].equals(key)&&pair[1].matches("[a-f0-9]{48}"))return pair[1];}return null;}
    private static void setCookie(HttpExchange x,String id){x.getResponseHeaders().set("Set-Cookie","balloon_sid="+id+"; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000");}
    private static String textField(Map<String,Object>b,String key){if(!(b.get(key)instanceof String s))throw new IllegalArgumentException("Требуется поле "+key);return s;}
    private static void only(Map<String,Object>b,String...keys){if(!b.keySet().equals(Set.of(keys)))throw new IllegalArgumentException("Неверный набор полей запроса");}
    private static Map<String,Object> body(HttpExchange x)throws IOException{
        String type=x.getRequestHeaders().getFirst("Content-Type");if(type==null||!type.toLowerCase(Locale.ROOT).startsWith("application/json"))throw new IllegalArgumentException("Нужен Content-Type: application/json");
        byte[] data=x.getRequestBody().readNBytes(32769);if(data.length>32768)throw new IllegalArgumentException("Запрос слишком большой");return object(Json.parse(new String(data,StandardCharsets.UTF_8)));
    }
    private static void send(HttpExchange x,int status,Object body)throws IOException{byte[] bytes=Json.string(body).getBytes(StandardCharsets.UTF_8);x.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");x.sendResponseHeaders(status,bytes.length);x.getResponseBody().write(bytes);}
    private void staticFile(HttpExchange x,String path)throws IOException{
        if(!Set.of("GET","HEAD").contains(x.getRequestMethod())){send(x,405,map("error","Метод не поддерживается"));return;}
        if(path.equals("/"))path="/index.html";if(path.equals("/admin"))path="/admin.html";if(path.equals("/presentation"))path="/presentation.html";
        Path file=web.resolve(path.substring(1)).normalize();
        if(!file.startsWith(web)||!Files.isRegularFile(file)||!file.toRealPath().startsWith(web.toRealPath())){send(x,404,map("error","Страница не найдена"));return;}
        String name=file.getFileName().toString();String type=name.endsWith(".html")?"text/html; charset=utf-8":name.endsWith(".css")?"text/css; charset=utf-8":name.endsWith(".js")?"text/javascript; charset=utf-8":name.endsWith(".png")?"image/png":name.endsWith(".svg")?"image/svg+xml":name.endsWith(".woff2")?"font/woff2":"application/octet-stream";
        x.getResponseHeaders().set("Content-Type",type);x.getResponseHeaders().set("Cache-Control","no-cache");
        if(x.getRequestMethod().equals("HEAD")){x.sendResponseHeaders(200,-1);return;}
        x.sendResponseHeaders(200,Files.size(file));Files.copy(file,x.getResponseBody());
    }
}
