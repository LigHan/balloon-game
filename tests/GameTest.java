package balloon;

import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import static balloon.Json.*;

/** Deterministic integration tests of the actual Java game service, without sleeps or a browser. */
public final class GameTest {
    static int assertions;
    static void check(boolean condition,String name){assertions++;if(!condition)throw new AssertionError(name);}
    static double number(Map<String,Object> m,String key){return ((Number)m.get(key)).doubleValue();}
    static void rejects(Runnable action,String name){boolean rejected=false;try{action.run();}catch(IllegalArgumentException ex){rejected=true;}check(rejected,name);}
    static final class Fixture {
        final Path dir,config;final AtomicLong time=new AtomicLong(1800000000000L);Game game;String user;
        Fixture()throws Exception{dir=Files.createTempDirectory("balloon-test-");config=dir.resolve("game.json");Files.copy(Path.of("config/game.json"),config);game=new Game(config,dir.resolve("data"),time::get,true,"test-seed");user=game.newPlayer();}
        Map<String,Object> state(){return game.state(user);}
        Map<String,Object> player(){return object(state().get("player"));}
        Map<String,Object> round(){return object(state().get("round"));}
        Map<String,Object> start(String theme,int tier,String scenario){game.setNextScenario(user,scenario);return game.start(user,theme,tier,UUID.randomUUID().toString());}
        void base(double base){Map<String,Object> r=round();time.set(((Number)r.get("startedAt")).longValue()+(long)Math.ceil(Math.log(base)/number(r,"growthRate")*1000));game.tick();}
        void finish(){time.addAndGet(200000);game.tick();}
    }
    public static void main(String[]args)throws Exception{
        parsing();cashout();booster();afterCashout();lossAndRewards();config();recovery();concurrency();honesty();
        System.out.println("PASS: "+assertions+" assertions across 9 test groups");
    }
    static void parsing(){
        check(Json.string(Json.parse("{\"а\": [1,true,null,\"строка\\n\"]}")).contains("строка\\n"),"JSON roundtrip");
        for(String bad:List.of("{\"a\":1,\"a\":2}","[1,]","NaN","1e999","01","{\"a\":}","1 2","\"x\n\""))rejects(()->Json.parse(bad),"Reject malformed JSON: "+bad);
    }
    static void cashout()throws Exception{
        Fixture f=new Fixture();String key=UUID.randomUUID().toString();f.game.setNextScenario(f.user,"cashout");Map<String,Object> r=f.game.start(f.user,"green",1,key);String id=(String)r.get("id");
        check(number(f.player(),"balance")==975,"Stake deducted exactly once");
        check(f.game.start(f.user,"green",1,key).get("id").equals(id),"Idempotent start returns original round");
        check(number(f.player(),"balance")==975,"Start retry cannot charge again");
        rejects(()->f.game.start(f.user,"green",0,UUID.randomUUID().toString()),"Cannot start second active round");
        rejects(()->f.game.cashout(f.user,id),"Cashout locked until first line");
        check(!r.containsKey("crashBase")&&!r.containsKey("proof"),"Outcome remains secret in flight");
        f.base(2.5);Map<String,Object> got=f.game.cashout(f.user,id);double payout=number(got,"payout"),mult=number(got,"cashoutMultiplier");
        check(number(got,"cashoutValue")==payout,"Displayed amount is also calculated by server");
        check(payout==Math.floor(25*mult*100)/100,"Payout uses fixed coefficient");
        check(number(f.player(),"balance")==975+payout,"Cashout immediately credited");
        check(got.get("status").equals("flying"),"Flight continues after cashout");
        f.game.cashout(f.user,id);check(number(f.player(),"balance")==975+payout,"Cashout retry cannot credit again");
        f.finish();check(f.round().get("status").equals("finished"),"Result after crash");
        check(number(f.round(),"payout")==payout,"Frozen payout after flight");
        check(((List<?>)f.state().get("history")).size()==1,"Completed flight enters history");
        check(f.round().get("reward")!=null,"Win includes additional reward");
        f.game.cashout(f.user,id);check(number(f.player(),"balance")==975+payout,"Finished cashout retry also idempotent");
    }
    static void booster()throws Exception{
        Fixture f=new Fixture();Map<String,Object> r=f.start("green",2,"booster");check(number(r,"boosterLevel")==2,"Scenario places booster on line 2");
        f.base(1.7);r=f.round();check(Boolean.TRUE.equals(r.get("boosterActivated")),"Booster activates");
        check(number(r,"multiplier")>=5.1&&number(r,"multiplier")<5.12,"Booster triples current coefficient");
        check(number(r,"points")==70,"Two lines and ×3 bonus scored");
        f.game.cashout(f.user,(String)r.get("id"));check(number(f.round(),"points")==95,"Cashout points added once");
        check(((List<?>)r.get("boundaries")).size()==9,"Green has 9 boundaries");
        f.finish();f.start("red",2,"booster");check(((List<?>)f.round().get("boundaries")).size()==12,"Red has 12 boundaries");
    }
    static void afterCashout()throws Exception{
        Fixture f=new Fixture();Map<String,Object> r=f.start("green",2,"booster");f.base(1.4);f.game.cashout(f.user,(String)r.get("id"));double fixed=number(f.round(),"cashoutMultiplier");f.base(3);
        check(!Boolean.TRUE.equals(f.round().get("boosterActivated")),"No activation after cashout");
        check(number(f.round(),"cashoutMultiplier")==fixed,"Cashout coefficient fixed");check(number(f.round(),"points")>35,"Line points continue after cashout");
    }
    static void lossAndRewards()throws Exception{
        Fixture f=new Fixture();Map<String,Object> r=f.start("green",0,"crash");f.finish();
        check(f.round().get("cashoutMultiplier")==null,"Loss has no cashout");check(number(f.player(),"balance")==990,"Loss retains stake deduction");
        check(number(f.round(),"points")==0,"Early crash before line has zero points");check(f.round().get("reward")!=null,"Loss also has reward");
        rejects(()->f.game.cashout(f.user,(String)r.get("id")),"Late cashout rejected");
        f.start("green",0,"cashout");f.finish();check(number(f.round(),"points")>0,"Loss after lines keeps points");
        for(int i=0;i<80;i++){if(number(f.player(),"balance")<20)f.game.topup(f.user);f.start("green",0,"crash");f.finish();}
        check(number(f.player(),"albums")>0,"Six different rewards complete albums");
        long remaining=((List<?>)f.player().get("stamps")).stream().mapToLong(v->((Number)v).longValue()).sum();
        check(remaining+6*(long)number(f.player(),"albums")==82,"Each flight gives exactly one stamp; albums consume six");
        double balance=number(f.player(),"balance");check(balance==1000-82*10+number(f.player(),"albums")*200,"Album bonus credited exactly");
        f.game.tick();check(number(f.player(),"balance")==balance,"Repeated tick cannot grant a second reward");
        Map<String,Object> cfg=object(Json.parse(Files.readString(f.config)));cfg.put("stakes",List.of(10000,10000,10000,10000));f.game.updateConfig(cfg);
        rejects(()->f.start("green",3,"random"),"Insufficient balance rejected");check(number(f.player(),"balance")==balance,"Rejected stake leaves balance unchanged");
    }
    static void config()throws Exception{
        Fixture f=new Fixture();Map<String,Object> old=f.start("green",0,"cashout");Map<String,Object> cfg=object(Json.parse(Files.readString(f.config)));cfg.put("points_per_line",37);f.game.updateConfig(cfg);
        f.base(1.4);check(number(f.round(),"points")==10,"Active round retains old point rules");f.finish();
        f.start("green",0,"cashout");f.base(1.4);check(number(f.round(),"points")==37,"New round uses saved point rules");
        Map<String,Object> bad=object(Json.parse(Json.string(cfg)));bad.put("points_per_line",-1);rejects(()->f.game.updateConfig(bad),"Invalid config rejected");
        bad.put("points_per_line",5);object(bad.get("green")).put("loot_weights",Collections.nCopies(9,0));rejects(()->f.game.updateConfig(bad),"Zero loot weights rejected");
        Map<String,Object> invalid=object(Json.parse(Json.string(cfg)));object(invalid.get("red")).put("levels",9);rejects(()->f.game.updateConfig(invalid),"Red must retain 12 lines");
        check(number(object(f.game.admin().get("config")),"points_per_line")==37,"Last valid config preserved");
        cfg.put("points_per_line",41);Files.writeString(f.config,Json.string(cfg));Files.setLastModifiedTime(f.config,FileTime.fromMillis(System.currentTimeMillis()+1000));f.game.tick();
        check(number(object(f.game.admin().get("config")),"points_per_line")==41,"External JSON hot reload works");
        Files.writeString(f.config,"broken");f.game.tick();check(number(object(f.game.admin().get("config")),"points_per_line")==41,"Malformed external file keeps valid config");
        check(!f.game.admin().get("error").equals(""),"Admin sees external file error");
    }
    static void recovery()throws Exception{
        Fixture f=new Fixture();Map<String,Object> r=f.start("red",0,"cashout");f.base(1.5);String user=f.user;
        f.game=new Game(f.config,f.dir.resolve("data"),f.time::get,true,"test-seed");check(f.game.hasPlayer(user),"Identity survives restart");
        check(f.round().get("id").equals(r.get("id")),"Active round survives restart");
        f.finish();double points=number(f.player(),"points");f.game=new Game(f.config,f.dir.resolve("data"),f.time::get,true,"test-seed");check(number(f.player(),"points")==points,"Restart cannot double-award points");
        String other=f.game.newPlayer();check(((List<?>)f.game.state(other).get("history")).size()==1,"History is shared across users");
        rejects(()->f.game.cashout(other,(String)r.get("id")),"Cannot cash out another user's round");
    }
    static void concurrency()throws Exception{
        Fixture f=new Fixture();Map<String,Object> r=f.start("green",0,"cashout");f.base(2);String id=(String)r.get("id");
        try(ExecutorService executor=Executors.newFixedThreadPool(10)){
            List<Callable<Map<String,Object>>> calls=new ArrayList<>();for(int i=0;i<30;i++)calls.add(()->f.game.cashout(f.user,id));
            for(Future<Map<String,Object>> got:executor.invokeAll(calls))check(number(got.get(),"payout")==20,"Concurrent payout response stable");
        }
        check(number(f.player(),"balance")==1010,"Thirty concurrent cashouts credit once");
        check(number(f.round(),"points")==45,"Concurrent cashout points granted once");
        f.finish();String key=UUID.randomUUID().toString();f.game.setNextScenario(f.user,"cashout");
        try(ExecutorService executor=Executors.newFixedThreadPool(10)){
            List<Callable<Map<String,Object>>> calls=new ArrayList<>();for(int i=0;i<20;i++)calls.add(()->f.game.start(f.user,"green",0,key));
            Set<Object> ids=new HashSet<>();for(Future<Map<String,Object>> got:executor.invokeAll(calls))ids.add(got.get().get("id"));check(ids.size()==1,"Concurrent starts yield one round");
        }
        check(number(f.player(),"balance")==1000,"Concurrent start debits once");
    }
    static void honesty()throws Exception{
        Fixture f=new Fixture();Map<String,Object> r=f.start("green",3,"random");String hash=(String)r.get("commitment");f.finish();
        check(Game.sha256((String)f.round().get("proof")).equals(hash),"Revealed proof matches preflight commitment");
        Map<String,Object> payload=object(Json.parse((String)f.round().get("proof")));Map<String,Object> t=object(object(payload.get("config")).get("green"));
        double u=Game.unit((String)payload.get("seed"),"crash"),expected=Math.floor((Math.min(number(t,"max_multiplier"),number(t,"min_crash_multiplier")/Math.pow(1-u,1/number(t,"alpha")))+1e-10)*100)/100;
        check(number(payload,"crashBase")==expected,"Crash recomputed from disclosed seed and model");
        check(!Game.sha256((String)f.round().get("proof")+" ").equals(hash),"Tampering changes hash");
        Fixture same=new Fixture();same.start("green",3,"random");same.finish();Map<String,Object> second=object(Json.parse((String)same.round().get("proof")));
        check(payload.get("crashBase").equals(second.get("crashBase"))&&payload.get("boosterLevel").equals(second.get("boosterLevel")),"Fixed seed reproduces random outcomes");
        Game prod=new Game(f.config,Files.createTempDirectory("balloon-prod-"),f.time::get,false,"");String user=prod.newPlayer();rejects(()->prod.setNextScenario(user,"cashout"),"Production disables controlled scenario");
    }
}
